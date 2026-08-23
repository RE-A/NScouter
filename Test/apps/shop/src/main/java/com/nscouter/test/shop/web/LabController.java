package com.nscouter.test.shop.web;

import com.nscouter.test.shop.service.LabService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ThreadLocalRandom;

/**
 * NScouter 스캐터 차트 검증용 엔드포인트.
 * 정상 트래픽만으로는 응답시간 분포와 에러 점을 만들 수 없어 별도로 둔다.
 */
@RestController
@RequestMapping("/shop/lab")
public class LabController {

    private final LabService labService;

    public LabController(LabService labService) {
        this.labService = labService;
    }

    /** 인위적 지연 — 스캐터 상단에 점을 찍는다. */
    @GetMapping("/slow")
    public Map<String, Object> slow(@RequestParam(defaultValue = "1500") long ms) throws InterruptedException {
        long capped = Math.min(Math.max(ms, 0), 30_000);
        Thread.sleep(capped);
        return Map.of("sleptMs", capped);
    }

    /** 랜덤 지연 — 부하 시나리오에서 산포를 만든다. */
    @GetMapping("/jitter")
    public Map<String, Object> jitter(@RequestParam(defaultValue = "50") long minMs,
                                      @RequestParam(defaultValue = "2000") long maxMs)
            throws InterruptedException {
        long lo = Math.max(0, minMs);
        long hi = Math.max(lo + 1, Math.min(maxMs, 30_000));
        long sleep = ThreadLocalRandom.current().nextLong(lo, hi);
        Thread.sleep(sleep);
        return Map.of("sleptMs", sleep);
    }

    /** 에러 발생 — XLogPack.error 가 0이 아니게 되어 빨간 점이 된다. */
    @GetMapping("/error")
    public Map<String, Object> error(@RequestParam(defaultValue = "http500") String type) {
        switch (type) {
            case "npe":
                String nothing = null;
                return Map.of("length", nothing.length());
            case "illegal":
                throw new IllegalStateException("의도적 IllegalStateException");
            case "http500":
            default:
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "의도적 500 응답");
        }
    }

    /** 별도 스레드 처리 — xType 이 달라진다. */
    @GetMapping("/async")
    public Map<String, Object> async() throws ExecutionException, InterruptedException {
        return Map.of("count", labService.countAsync().get());
    }

    /** N+1 쿼리 — sqlCount / sqlTime 을 키운다. */
    @GetMapping("/heavy-sql")
    public Map<String, Object> heavySql(@RequestParam(defaultValue = "30") int limit) {
        return Map.of("sum", labService.heavySql(Math.min(Math.max(limit, 1), 50)));
    }
}
