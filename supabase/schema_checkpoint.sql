--
-- PostgreSQL database dump
--

\restrict TjoLcF21SNAoQe9o4fQzX29fAiZKnsr1kk7jL9JlgISRbuF2zfcm4mFzIAKyar6

-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: search_by_embedding(public.vector, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_by_embedding(q public.vector, prefer_book text) RETURNS TABLE(explanation_id uuid, title text, dist real, book text, start_chapter integer, start_verse integer, end_chapter integer, end_verse integer, granularity text)
    LANGUAGE sql
    AS $$
  select
    e.id as explanation_id,
    e.title,
    (e.embedding <-> q) as dist,
    pm.book, pm.start_chapter, pm.start_verse, pm.end_chapter, pm.end_verse, pm.granularity
  from explanation e
  join passage_mention pm on pm.explanation_id = e.id
  where e.embedding is not null
    and (prefer_book is null or pm.book ilike prefer_book)
  order by e.embedding <-> q
  limit 50;
$$;


--
-- Name: search_by_embedding(public.vector, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_by_embedding(q public.vector, prefer_book text, prefer_author text) RETURNS TABLE(explanation_id uuid, title text, author text, book text, start_chapter integer, start_verse integer, end_chapter integer, end_verse integer, dist double precision, body text)
    LANGUAGE sql STABLE
    AS $$
  SELECT
    e.id,
    e.title,
    e.author,
    pm.book,
    pm.start_chapter,
    pm.start_verse,
    pm.end_chapter,
    pm.end_verse,
    (e.embedding <-> q) AS dist,
    e.body
  FROM public.explanation e
  JOIN public.passage_mention pm
    ON pm.explanation_id = e.id
  WHERE (prefer_author IS NULL OR e.author ILIKE prefer_author)
    AND (prefer_book   IS NULL OR pm.book   ILIKE prefer_book)
  ORDER BY e.embedding <-> q
  LIMIT 50;
$$;


--
-- Name: search_explanations_with_mentions(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_explanations_with_mentions(tsquery_input text, prefer_book text, prefer_author text) RETURNS TABLE(explanation_id uuid, title text, author text, snippet text, rank double precision, book text, start_chapter integer, start_verse integer, end_chapter integer, end_verse integer, granularity text, body text)
    LANGUAGE sql STABLE
    AS $$
  WITH q AS (
    SELECT to_tsquery('english', tsquery_input) AS tsq
  ),
  ranked AS (
    SELECT
      e.id,
      e.title,
      e.author,
      ts_headline('english', e.body, (SELECT tsq FROM q),
                  'MaxFragments=2, MinWords=5, MaxWords=20') AS snippet,
      ts_rank_cd(e.fts, (SELECT tsq FROM q)) AS rank
    FROM explanation e
    WHERE e.fts @@ (SELECT tsq FROM q)
      AND (prefer_author IS NULL OR e.author ILIKE prefer_author)
    ORDER BY rank DESC
    LIMIT 50
  )
  SELECT
    r.id AS explanation_id,
    r.title,
    r.author,
    r.snippet,
    r.rank,
    pm.book,
    pm.start_chapter,
    pm.start_verse,
    pm.end_chapter,
    pm.end_verse,
    pm.granularity,
    e.body
  FROM ranked r
  JOIN passage_mention pm ON pm.explanation_id = r.id
  JOIN explanation e      ON e.id = r.id
  WHERE (prefer_book IS NULL) OR (pm.book ILIKE prefer_book)
  ORDER BY r.rank DESC, pm.book, pm.start_chapter, COALESCE(pm.start_verse, 0);
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: explanation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.explanation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text,
    author text,
    lang text DEFAULT 'en'::text,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    fts tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(body, ''::text)))) STORED,
    embedding public.vector(1536)
);


--
-- Name: explanation_theme; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.explanation_theme (
    explanation_id uuid NOT NULL,
    theme_id bigint NOT NULL,
    weight real DEFAULT 1.0
);


--
-- Name: passage_mention; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passage_mention (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    explanation_id uuid,
    book text NOT NULL,
    start_chapter integer NOT NULL,
    start_verse integer,
    end_chapter integer,
    end_verse integer,
    ref_citation text,
    granularity text DEFAULT 'range'::text,
    CONSTRAINT passage_mention_granularity_check CHECK ((granularity = ANY (ARRAY['verse'::text, 'range'::text, 'chapter'::text])))
);


--
-- Name: synonym; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.synonym (
    a_theme_id bigint NOT NULL,
    b_theme_id bigint NOT NULL,
    relation text DEFAULT 'synonym'::text,
    weight real DEFAULT 1.0
);


--
-- Name: theme; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.theme (
    id bigint NOT NULL,
    lemma text NOT NULL
);


--
-- Name: theme_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.theme_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: theme_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.theme_id_seq OWNED BY public.theme.id;


--
-- Name: theme id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.theme ALTER COLUMN id SET DEFAULT nextval('public.theme_id_seq'::regclass);


--
-- Name: explanation explanation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explanation
    ADD CONSTRAINT explanation_pkey PRIMARY KEY (id);


--
-- Name: explanation_theme explanation_theme_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explanation_theme
    ADD CONSTRAINT explanation_theme_pkey PRIMARY KEY (explanation_id, theme_id);


--
-- Name: passage_mention passage_mention_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passage_mention
    ADD CONSTRAINT passage_mention_pkey PRIMARY KEY (id);


--
-- Name: synonym synonym_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synonym
    ADD CONSTRAINT synonym_pkey PRIMARY KEY (a_theme_id, b_theme_id);


--
-- Name: theme theme_lemma_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.theme
    ADD CONSTRAINT theme_lemma_key UNIQUE (lemma);


--
-- Name: theme theme_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.theme
    ADD CONSTRAINT theme_pkey PRIMARY KEY (id);


--
-- Name: explanation_author_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX explanation_author_lower_idx ON public.explanation USING btree (lower(author));


--
-- Name: explanation_body_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX explanation_body_trgm_idx ON public.explanation USING gin (body public.gin_trgm_ops);


--
-- Name: explanation_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX explanation_embedding_idx ON public.explanation USING ivfflat (embedding) WITH (lists='100');


--
-- Name: explanation_fts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX explanation_fts_idx ON public.explanation USING gin (fts);


--
-- Name: passage_mention_book_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX passage_mention_book_idx ON public.passage_mention USING btree (book);


--
-- Name: passage_mention_expl_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX passage_mention_expl_idx ON public.passage_mention USING btree (explanation_id);


--
-- Name: pm_book_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_book_idx ON public.passage_mention USING btree (book, start_chapter);


--
-- Name: pm_expl_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_expl_idx ON public.passage_mention USING btree (explanation_id);


--
-- Name: explanation_theme explanation_theme_explanation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explanation_theme
    ADD CONSTRAINT explanation_theme_explanation_id_fkey FOREIGN KEY (explanation_id) REFERENCES public.explanation(id) ON DELETE CASCADE;


--
-- Name: explanation_theme explanation_theme_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.explanation_theme
    ADD CONSTRAINT explanation_theme_theme_id_fkey FOREIGN KEY (theme_id) REFERENCES public.theme(id);


--
-- Name: passage_mention passage_mention_explanation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passage_mention
    ADD CONSTRAINT passage_mention_explanation_id_fkey FOREIGN KEY (explanation_id) REFERENCES public.explanation(id) ON DELETE CASCADE;


--
-- Name: synonym synonym_a_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synonym
    ADD CONSTRAINT synonym_a_theme_id_fkey FOREIGN KEY (a_theme_id) REFERENCES public.theme(id);


--
-- Name: synonym synonym_b_theme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synonym
    ADD CONSTRAINT synonym_b_theme_id_fkey FOREIGN KEY (b_theme_id) REFERENCES public.theme(id);


--
-- PostgreSQL database dump complete
--

\unrestrict TjoLcF21SNAoQe9o4fQzX29fAiZKnsr1kk7jL9JlgISRbuF2zfcm4mFzIAKyar6

