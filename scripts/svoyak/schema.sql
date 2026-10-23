PRAGMA foreign_keys=ON;
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE packs(id INTEGER PRIMARY KEY,title TEXT NOT NULL,package_name TEXT,package_id TEXT,
 version TEXT,date TEXT,authors_json TEXT,source_url TEXT NOT NULL,archive_path TEXT NOT NULL,
 archive_sha256 TEXT NOT NULL,bytes INTEGER,raw_xml BLOB NOT NULL,rights_status TEXT NOT NULL DEFAULT 'unknown');
CREATE TABLE rounds(id TEXT PRIMARY KEY,pack_id INTEGER NOT NULL REFERENCES packs(id),ordinal INTEGER,name TEXT,type TEXT);
CREATE TABLE themes(id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES rounds(id),ordinal INTEGER,name TEXT);
CREATE TABLE assets(id TEXT PRIMARY KEY,pack_id INTEGER NOT NULL REFERENCES packs(id),entry_name TEXT NOT NULL,
 mime TEXT,bytes INTEGER,sha256 TEXT NOT NULL,UNIQUE(pack_id,entry_name));
CREATE TABLE questions(id TEXT PRIMARY KEY,pack_id INTEGER NOT NULL REFERENCES packs(id),theme_id TEXT NOT NULL REFERENCES themes(id),
 ordinal INTEGER,price INTEGER,prompt TEXT NOT NULL,answer_text TEXT NOT NULL,answer_key TEXT,
 raw_xml TEXT NOT NULL,raw_sha256 TEXT NOT NULL,atoms_json TEXT NOT NULL,source_info_json TEXT NOT NULL,
 format TEXT NOT NULL,difficulty INTEGER,difficulty_basis TEXT NOT NULL,text_only INTEGER NOT NULL,
 mature_hint INTEGER NOT NULL,flags_json TEXT NOT NULL,review_status TEXT NOT NULL DEFAULT 'unreviewed',
 content_fingerprint TEXT NOT NULL,duplicate_group TEXT);
CREATE TABLE answers(question_id TEXT NOT NULL REFERENCES questions(id),ordinal INTEGER,text TEXT NOT NULL,is_correct INTEGER NOT NULL,
 PRIMARY KEY(question_id,is_correct,ordinal));
CREATE TABLE question_media(id TEXT PRIMARY KEY,question_id TEXT NOT NULL REFERENCES questions(id),phase TEXT,
 ordinal INTEGER,type TEXT,reference TEXT,asset_id TEXT REFERENCES assets(id),external_url TEXT,status TEXT NOT NULL);
CREATE TABLE topics(slug TEXT PRIMARY KEY,label TEXT NOT NULL,description TEXT NOT NULL);
CREATE TABLE question_topics(question_id TEXT NOT NULL REFERENCES questions(id),topic_slug TEXT NOT NULL REFERENCES topics(slug),
 score REAL NOT NULL,basis TEXT NOT NULL,PRIMARY KEY(question_id,topic_slug));
CREATE TABLE embeddings(question_id TEXT PRIMARY KEY REFERENCES questions(id),model_id TEXT NOT NULL,dimension INTEGER NOT NULL,vector BLOB NOT NULL);
CREATE TABLE question_links(question_id TEXT NOT NULL REFERENCES questions(id),related_id TEXT NOT NULL REFERENCES questions(id),
 kind TEXT NOT NULL,score REAL NOT NULL,PRIMARY KEY(question_id,related_id,kind));
CREATE TABLE adaptations(id TEXT PRIMARY KEY,original_id TEXT NOT NULL REFERENCES questions(id),prompt TEXT NOT NULL,
 answer TEXT NOT NULL,changes TEXT NOT NULL,data_json TEXT NOT NULL,review_status TEXT NOT NULL DEFAULT 'editorial_draft');
CREATE VIRTUAL TABLE question_fts USING fts5(question_id UNINDEXED,prompt,answers,theme,topics,tokenize='unicode61 remove_diacritics 2',prefix='2 3 4');
CREATE INDEX questions_pack ON questions(pack_id);
CREATE INDEX questions_filters ON questions(text_only,mature_hint,difficulty);
CREATE INDEX question_topics_topic ON question_topics(topic_slug,question_id);
CREATE INDEX questions_fingerprint ON questions(content_fingerprint);
CREATE INDEX questions_answer_key ON questions(answer_key);
CREATE INDEX media_question ON question_media(question_id,phase);
