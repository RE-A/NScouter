package com.nscouter.test.shop.init;

import com.nscouter.test.shop.domain.Product;
import com.nscouter.test.shop.domain.Stock;
import com.nscouter.test.shop.repository.ProductRepository;
import com.nscouter.test.shop.repository.StockRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

@Component
public class DataSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private static final String[] CATEGORIES = {"electronics", "book", "food", "clothing", "toy"};
    private static final String[] WAREHOUSES = {"SEOUL", "BUSAN", "DAEJEON"};

    private final DataSource dataSource;
    private final ProductRepository productRepository;
    private final StockRepository stockRepository;

    public DataSeeder(DataSource dataSource,
                      ProductRepository productRepository,
                      StockRepository stockRepository) {
        this.dataSource = dataSource;
        this.productRepository = productRepository;
        this.stockRepository = stockRepository;
    }

    @Override
    public void run(String... args) throws Exception {
        logDatabaseInfo();

        if (productRepository.count() > 0) {
            log.info("시드 데이터 이미 존재 — 건너뜀 (product {}건)", productRepository.count());
            return;
        }

        List<Product> products = new ArrayList<>();
        for (int i = 1; i <= 200; i++) {
            String category = CATEGORIES[i % CATEGORIES.length];
            products.add(new Product("상품-" + i, category, 1000 + (i * 137) % 90000));
        }
        productRepository.saveAll(products);

        List<Stock> stocks = new ArrayList<>();
        for (Product p : products) {
            int count = ThreadLocalRandom.current().nextInt(1, 3);
            for (int w = 0; w < count; w++) {
                stocks.add(new Stock(p.getId(),
                        ThreadLocalRandom.current().nextInt(0, 500),
                        WAREHOUSES[w % WAREHOUSES.length]));
            }
        }
        stockRepository.saveAll(stocks);

        log.info("시드 완료 — product {}건, stock {}건", products.size(), stocks.size());
    }

    /** 실제로 어떤 DB에 붙었는지 기동 로그로 남긴다. */
    private void logDatabaseInfo() {
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
