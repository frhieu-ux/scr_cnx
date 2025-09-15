--
-- PostgreSQL database dump
--

\restrict 3cewg20E9ET86EASN6VBcWTJgBjq9GgnsFUyBSOvO9weBVDVADAz60cFDcX2mlY

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
-- Data for Name: theme; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.theme (id, lemma) FROM stdin;
1	birth
3	born
4	manger
5	crib
6	infancy
7	incarnation
2	nativity
\.


--
-- Data for Name: synonym; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.synonym (a_theme_id, b_theme_id, relation, weight) FROM stdin;
1	2	synonym	1
1	3	near	0.9
1	4	context	0.6
1	5	context	0.6
1	6	near	0.8
1	7	near	0.6
\.


--
-- Name: theme_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.theme_id_seq', 11, true);


--
-- PostgreSQL database dump complete
--

\unrestrict 3cewg20E9ET86EASN6VBcWTJgBjq9GgnsFUyBSOvO9weBVDVADAz60cFDcX2mlY

