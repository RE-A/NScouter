package com.nscouter.test.shop.repository;

import com.nscouter.test.shop.domain.AuditLog;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AuditLogRepository extends JpaRepository<AuditLog, Long> {
}
