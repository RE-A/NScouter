package com.nscouter.test.order.repository;

import com.nscouter.test.order.domain.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface OrderRepository extends JpaRepository<Order, Long> {

    List<Order> findTop50ByOrderByIdDesc();

    /** 집계 쿼리 — 느린 SQL 을 만들어 sqlTime 이 큰 XLog 를 생성한다. */
    @Query("""
            select o.status, count(o), sum(o.totalPrice), avg(o.quantity)
            from Order o
            group by o.status
            order by count(o) desc
            """)
    List<Object[]> summarizeByStatus();
}
