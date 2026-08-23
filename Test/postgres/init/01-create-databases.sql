-- shop-app / order-app 각각의 데이터베이스를 분리한다.
-- POSTGRES_DB 로 만들어지는 기본 DB(scouter)는 접속 확인용으로만 남겨둔다.
CREATE DATABASE shopdb;
CREATE DATABASE orderdb;
