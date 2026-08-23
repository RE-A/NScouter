package com.nscouter.test.order.init;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;

/** 실제로 어떤 DB에 붙었는지 기동 로그로 남긴다. */
@Component
public class DbInfoLogger implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DbInfoLogger.class);

    private final DataSource dataSource;

    public DbInfoLogger(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public void run(String... args) {
        try (Connection conn = dataSource.getConnection()) {
            DatabaseMetaData meta = conn.getMetaData();
            log.info("DB 접속: {} {} / driver {} {} / url {}",
                    meta.getDatabaseProductName(),
                    meta.getDatabaseProductVersion(),
                    meta.getDriverName(),
                    meta.getDriverVersion(),
                    meta.getURL());
        } catch (Exception e) {
            log.warn("DB 메타데이터 조회 실패", e);
        }
    }
}
