package com.nscouter.test.shop.service;

import com.nscouter.test.shop.domain.Product;
import com.nscouter.test.shop.domain.Stock;
import com.nscouter.test.shop.repository.ProductRepository;
import com.nscouter.test.shop.repository.StockRepository;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    private final EntityManager entityManager;

    public LabService(ProductRepository productRepository,
                      StockRepository stockRepository,
                      DataSource dataSource,
                      EntityManager entityManager) {
        this.productRepository = productRepository;
        this.stockRepository = stockRepository;
        this.dataSource = dataSource;
        this.entityManager = entityManager;
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
     * PreparedStatement 로 보내도 리터럴 치환은 돌지만, JPA 가 만드는 SQL 은 값이
     * 전부 `?` 라서 바꿀 리터럴이 없다. 값이 문장에 박힌 모양을 확실히 만들려고
     * 여기서는 Statement 를 쓴다. (섞인 경우는 `mixedSql()` 을 보라.)
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
     * **리터럴과 바인딩이 한 문장에 같이** 있는 SQL (F-51 재현).
     *
     * 손으로 쓴 SQL 은 이 모양이 흔하다 — 코드값은 문장에 박고, 사용자 입력만 `?` 로 넘긴다.
     * 에이전트는 리터럴을 `@{n}` 으로 바꾸고 그 값들을 파라미터 앞쪽에 놓은 뒤,
     * PreparedStatement 바인딩 값을 **그 뒤에** 이어 붙인다
     * (TraceSQL.start(Object): escapeLiteral → ctx.sql.toString(step.param)).
     *
     * 그래서 클라이언트가 `?` 를 값 목록 0번부터 채우면 리터럴 값이 다시 들어가고
     * 진짜 바인딩 값은 «쓰이지 않은 값» 으로 밀려난다. 그게 실환경에서
     * «파라미터가 안 나온다» 로 보이던 증상이라 여기서 재현한다.
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> mixedSql(int minId, String name) {
        return entityManager.createNativeQuery(
                        "/*mixed-sql*/ select p.id, p.name, p.price from product p"
                                + " where p.category = 'book' and p.price between 100 and 90000"
                                + " and p.id > ? and p.name <> ?"
                                + " order by p.id limit 5")
                .setParameter(1, minId)
                .setParameter(2, name)
                .getResultList();
    }

    /**
     * **행 수를 아는 UPDATE.** 몇 행을 바꿨는지 JDBC 가 돌려주는 값을 그대로 반환한다.
     *
     * 화면의 «N행» 표시(`SqlStep3.updated`)가 진짜 행 수인지 가르기 위한 것이다.
     * 에이전트는 `getUpdateCount()` 가 불릴 때마다 **더한다**
     * (`TraceSQL.incUpdateCount`: `step.updated = cur + n`).
     * 그래서 같은 실행에서 두 번 물어보면 실제의 두 배가 신고될 수 있다.
     *
     * 값을 실제로 바꾸지는 않는다(`name = name`). 데이터를 흔들지 않으면서
     * 정확히 n 행을 건드리는 UPDATE 를 만든다.
     */
    @Transactional
    public int touchRows(int n) {
        return entityManager.createNativeQuery(
                        "/*touch-rows*/ update product set name = name"
                                + " where id in (select id from product order by id limit ?)")
                .setParameter(1, n)
                .executeUpdate();
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
