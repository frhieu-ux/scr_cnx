-- Enable extensions
create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- Explanations
create table if not exists explanation (
  id uuid primary key default gen_random_uuid(),
  title text,
  author text,
  lang text default 'en',
  body text not null,
  created_at timestamp with time zone default now(),
  fts tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))) stored
);

create index if not exists explanation_fts_idx on explanation using gin (fts);
create index if not exists explanation_body_trgm_idx on explanation using gin (body gin_trgm_ops);

-- Passage mentions
create table if not exists passage_mention (
  id uuid primary key default gen_random_uuid(),
  explanation_id uuid references explanation(id) on delete cascade,
  book text not null,
  start_chapter int not null,
  start_verse int,
  end_chapter int,
  end_verse int,
  ref_citation text,
  granularity text check (granularity in ('verse','range','chapter')) default 'range'
);

create index if not exists pm_expl_idx on passage_mention(explanation_id);
create index if not exists pm_book_idx on passage_mention(book, start_chapter);

-- Themes and synonyms
create table if not exists theme (
  id bigserial primary key,
  lemma text unique not null
);

create table if not exists explanation_theme (
  explanation_id uuid references explanation(id) on delete cascade,
  theme_id bigint references theme(id),
  weight real default 1.0,
  primary key (explanation_id, theme_id)
);

create table if not exists synonym (
  a_theme_id bigint references theme(id),
  b_theme_id bigint references theme(id),
  relation text default 'synonym',
  weight real default 1.0,
  primary key (a_theme_id, b_theme_id)
);

-- Seed small "birth" cluster
insert into theme (lemma) values
  ('birth'), ('nativity'), ('born'), ('manger'), ('crib'), ('infancy'), ('incarnation')
on conflict do nothing;

with ids as (
  select
    (select id from theme where lemma='birth') as birth,
    (select id from theme where lemma='nativity') as nativity,
    (select id from theme where lemma='born') as born,
    (select id from theme where lemma='manger') as manger,
    (select id from theme where lemma='crib') as crib,
    (select id from theme where lemma='infancy') as infancy,
    (select id from theme where lemma='incarnation') as incarnation
)
insert into synonym (a_theme_id, b_theme_id, relation, weight)
select birth, nativity, 'synonym', 1.0 from ids union all
select birth, born,     'near',    0.9 from ids union all
select birth, manger,   'context', 0.6 from ids union all
select birth, crib,     'context', 0.6 from ids union all
select birth, infancy,  'near',    0.8 from ids union all
select birth, incarnation, 'near', 0.6 from ids
on conflict do nothing;

-- RPC for search
create or replace function search_explanations_with_mentions(tsquery_input text, prefer_book text)
returns table(
  explanation_id uuid,
  title text,
  snippet text,
  rank real,
  book text,
  start_chapter int,
  start_verse int,
  end_chapter int,
  end_verse int,
  granularity text
)
language plpgsql as $$
begin
  return query
  with q as (
    select to_tsquery('english', tsquery_input) as tsq
  ),
  ranked as (
    select e.id, e.title,
           ts_headline('english', e.body, q.tsq, 'MaxFragments=2, MinWords=5, MaxWords=20') as snippet,
           ts_rank_cd(e.fts, q.tsq) as rank
    from explanation e, q
    where e.fts @@ q.tsq
    order by rank desc
    limit 50
  )
  select r.id as explanation_id, r.title, r.snippet, r.rank,
         pm.book, pm.start_chapter, pm.start_verse, pm.end_chapter, pm.end_verse, pm.granularity
  from ranked r
  join passage_mention pm on pm.explanation_id = r.id
  where (prefer_book is null) or (pm.book ilike prefer_book)
  order by r.rank desc, pm.book, pm.start_chapter, coalesce(pm.start_verse,0);
end;
$$;

-- RLS note: Keep RLS ON (default); we'll access via Edge Functions.
