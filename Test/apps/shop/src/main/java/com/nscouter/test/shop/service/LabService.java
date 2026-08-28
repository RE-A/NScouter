package com.nscouter.test.shop.service;

import com.nscouter.test.shop.domain.Product;
import com.nscouter.test.shop.domain.Stock;
import com.nscouter.test.shop.repository.ProductRepository;
import com.nscouter.test.shop.repository.StockRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.concurrent.CompletableFuture;

@Service
public class LabService {

    private static final Logger log = LoggerFactory.getLogger(LabService.class);

    private final ProductRepository productRepository;
    private final StockRepository stockRepository;
    private final DataSource dataSource;

    public LabService(ProductRepository productRepository,
                      StockRepository stockRepository,
                      DataSource dataSource) {
        this.productRepository = productRepository;
        this.stockRepository = stockRepository;
        this.dataSource = dataSource;
    }

    /**
     * 별도 스레드에서 실행된다. Scouter 는 이런 트랜잭션을 다른 xType 으로 기록하며,
     * NScouter 스캐터에서 회색/연빨강 점으로 표시된다.
     */
    @Async
    public CompletableFuture<Integer> countAsync() {
        try {
            Thread.sleep(120);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        int total = (int) productRepository.count();
        log.debug("countAsync 완료: {}", total);
        return CompletableFuture.completedFuture(total);
    }

    /**
     * 의도적 N+1. sqlCount / sqlTime 이 커진 XLog 를 만든다.
     */
    public int heavySql(int limit) {
        List<Product> products = productRepository.findTop50ByOrderByIdDesc();
        int sum = 0;
        int handled = 0;
        for (Product p : products) {
            if (handled++ >= limit) {
                break;
            }
            for (Stock s : stockRepository.findByProductId(p.getId())) {
                sum += s.getQuantity();
            }
        }
        return sum;
    }

    /**
     * 값을 문장에 박은 SQL 을 **PreparedStatement 가 아니라 Statement** 로 실행한다.
     *
     * 에이전트의 리터럴 치환(profile_sql_escape_enabled)은 Statement 경로에서만 돈다
     * (TraceSQL.start(Object) → escapeLiteral). PreparedStatement 로 보내면
     * 값이 그대로 남아 `@{n}` 이 생기지 않는다 — 그래서 여기서는 일부러 Statement 다.
     *
     * 켜져 있으면 프로파일에는 문자열이 '@{n}', 숫자가 @{n} 으로 오고
     * 값은 파라미터로 따로 온다. 운영 환경에서 그렇게 오는 SQL 을 재현한다 (B-1).
     */
    public int literalSql() {
        String sql = "/*literal-sql*/ select count(*) from product p"
                + " where p.category = 'fruit' and p.id > 100 and 1 = 1";
        try (Connection conn = dataSource.getConnection();
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(sql)) {
            int count = rs.next() ? rs.getInt(1) : 0;
            log.debug("literalSql 완료: {}", count);
            return count;
        } catch (SQLException e) {
            throw new IllegalStateException("literal-sql 실패", e);
        }
    }

    /**
     * 리터럴이 여러 개인 SQL. 에이전트가 치환하면 `@{1}` … `@{11}` 이 된다.
     *
     * 실환경에서 본 문장이 이 모양이었다 — 문자열과 숫자가 섞이고, 뒤쪽에
     * `where 1 = 1` 처럼 **번호만 차지하는 자리**도 있다.
     */
    public int inClauseSql() {
        String sql = "/*in-clause*/ select count(*) from product p"
                + " where p.category in ('fruit', 'grain', 'dairy', 'meat')"
                + " and p.price between 100 and 90000"
                + " and p.id > 0 and 1 = 1"
                + " and p.name <> 'no-such-name'";
        try (Connection conn = dataSource.getConnection();
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(sql)) {
            int count = rs.next() ? rs.getInt(1) : 0;
            log.debug("inClauseSql 완료: {}", count);
            return count;
        } catch (SQLException e) {
            throw new IllegalStateException("in-clause 실패", e);
        }
    }
}
