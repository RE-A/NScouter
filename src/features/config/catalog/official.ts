// 스카우터 공식 설정 문서에서 뽑은 원문 — **손으로 고치지 말 것.**
//
// 출처: https://raw.githubusercontent.com/scouter-project/scouter/master/scouter.document/main/Configuration.md
// 생성: tools/gen_config_catalog.py (2026-09-12)
//
// 공식 문서는 `Configure.java` 원문이다. 설명은 필드의 `@ConfigDesc`, 구역은 `//Network`
// 같은 주석이다. 한국어 이름·설명은 `ko*.ts` 에 따로 둔다 — 여기는 원문만 담는다.

import type { OfficialCatalog } from './types';

export const OFFICIAL: OfficialCatalog = {
  "server": [
    {
      "key": "log_tcp_action_enabled",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging TCP connection related event"
    },
    {
      "key": "log_udp_multipacket",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming MultiPacket"
    },
    {
      "key": "log_expired_multipacket",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "true",
      "desc": "Logging expired MultiPacket"
    },
    {
      "key": "log_udp_packet",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging all incoming packs"
    },
    {
      "key": "log_udp_counter",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming CounterPack"
    },
    {
      "key": "log_udp_interaction_counter",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming PerfInteractionCounterPack"
    },
    {
      "key": "log_udp_xlog",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming XLogPack"
    },
    {
      "key": "log_udp_profile",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming ProfilePack"
    },
    {
      "key": "log_udp_text",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming TextPack"
    },
    {
      "key": "log_udp_alert",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming AlertPack"
    },
    {
      "key": "log_udp_object",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming ObjectPack"
    },
    {
      "key": "log_udp_status",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming StatusPack"
    },
    {
      "key": "log_udp_stack",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming StackPack"
    },
    {
      "key": "log_udp_summary",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming SummaryPack"
    },
    {
      "key": "log_udp_batch",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming BatchPack"
    },
    {
      "key": "log_service_handler_list",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging all request handlers in starting"
    },
    {
      "key": "log_udp_span",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging incoming SpanPack"
    },
    {
      "key": "log_index_traversal_warning_count",
      "section": "(구역 없음)",
      "type": "int",
      "default": "100",
      "desc": "Logging when index traversal is too heavy."
    },
    {
      "key": "log_rotation_enabled",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "true",
      "desc": "Retaining log according to date"
    },
    {
      "key": "log_keep_days",
      "section": "(구역 없음)",
      "type": "int",
      "default": "31",
      "desc": "Keeping period of log"
    },
    {
      "key": "log_sql_parsing_fail_enabled",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": "Logging sql failed to parse"
    },
    {
      "key": "_trace",
      "section": "(구역 없음)",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "net_udp_listen_ip",
      "section": "Network",
      "type": "String",
      "default": "0.0.0.0",
      "desc": "UDP Host"
    },
    {
      "key": "net_udp_listen_port",
      "section": "Network",
      "type": "int",
      "default": "NetConstants.SERVER_UDP_PORT",
      "desc": "UDP Port"
    },
    {
      "key": "net_tcp_listen_ip",
      "section": "Network",
      "type": "String",
      "default": "0.0.0.0",
      "desc": "TCP Host"
    },
    {
      "key": "net_tcp_listen_port",
      "section": "Network",
      "type": "int",
      "default": "NetConstants.SERVER_TCP_PORT",
      "desc": "TCP Port"
    },
    {
      "key": "net_tcp_client_so_timeout_ms",
      "section": "Network",
      "type": "int",
      "default": "8000",
      "desc": "Client Socket Timeout(ms)"
    },
    {
      "key": "net_tcp_agent_so_timeout_ms",
      "section": "Network",
      "type": "int",
      "default": "60000",
      "desc": "Agent Socket Timeout(ms)"
    },
    {
      "key": "net_tcp_agent_keepalive_interval_ms",
      "section": "Network",
      "type": "int",
      "default": "5000",
      "desc": "Transfer period(ms) of KEEP_ALIVE"
    },
    {
      "key": "net_tcp_get_agent_connection_wait_ms",
      "section": "Network",
      "type": "int",
      "default": "1000",
      "desc": "Waiting time(ms) for agent session"
    },
    {
      "key": "net_udp_packet_buffer_size",
      "section": "Network",
      "type": "int",
      "default": "65535",
      "desc": "UDP Packet Buffer Size"
    },
    {
      "key": "net_udp_so_rcvbuf_size",
      "section": "Network",
      "type": "int",
      "default": "1024 * 1024 * 4",
      "desc": "UDP Receiver Buffer Size"
    },
    {
      "key": "_net_udp_worker_thread_count",
      "section": "Network",
      "type": "int",
      "default": "3",
      "desc": ""
    },
    {
      "key": "net_tcp_service_pool_size",
      "section": "Network",
      "type": "int",
      "default": "100",
      "desc": "TCP Thread Pool Size"
    },
    {
      "key": "net_http_server_enabled",
      "section": "Network",
      "type": "boolean",
      "default": "false",
      "desc": "Activating Http Server"
    },
    {
      "key": "net_http_port",
      "section": "Network",
      "type": "int",
      "default": "NetConstants.SERVER_HTTP_PORT",
      "desc": "Http Port"
    },
    {
      "key": "net_http_extweb_dir",
      "section": "Network",
      "type": "String",
      "default": "./extweb",
      "desc": "user extension web root"
    },
    {
      "key": "net_http_api_enabled",
      "section": "Network",
      "type": "boolean",
      "default": "false",
      "desc": "Activating Scouter API"
    },
    {
      "key": "net_http_api_swagger_enabled",
      "section": "Network",
      "type": "boolean",
      "default": "false",
      "desc": "Enable a swagger for HTTP API."
    },
    {
      "key": "net_http_api_swagger_host_ip",
      "section": "Network",
      "type": "String",
      "default": "",
      "desc": "Swagger option of host's ip or domain to call APIs."
    },
    {
      "key": "net_http_api_cors_allow_origin",
      "section": "Network",
      "type": "String",
      "default": "*",
      "desc": "API CORS support for Access-Control-Allow-Origin"
    },
    {
      "key": "net_http_api_cors_allow_credentials",
      "section": "Network",
      "type": "String",
      "default": "true",
      "desc": "Access-Control-Allow-Credentials"
    },
    {
      "key": "net_webapp_tcp_client_pool_size",
      "section": "Network",
      "type": "int",
      "default": "30",
      "desc": "size of webapp connection pool to collector"
    },
    {
      "key": "net_webapp_tcp_client_pool_timeout",
      "section": "Network",
      "type": "int",
      "default": "60000",
      "desc": "timeout of web app connection pool to collector"
    },
    {
      "key": "net_webapp_tcp_client_so_timeout",
      "section": "Network",
      "type": "int",
      "default": "30000",
      "desc": "So timeout of web app to collector"
    },
    {
      "key": "net_http_api_auth_ip_enabled",
      "section": "Network",
      "type": "boolean",
      "default": "false",
      "desc": "Enable api access control by client ip"
    },
    {
      "key": "net_http_api_auth_ip_header_key",
      "section": "Network",
      "type": "String",
      "default": "",
      "desc": "If get api caller's ip from http header."
    },
    {
      "key": "net_http_api_auth_session_enabled",
      "section": "Network",
      "type": "boolean",
      "default": "false",
      "desc": "Enable api access control by JSESSIONID of Cookie"
    },
    {
      "key": "net_http_api_session_timeout",
      "section": "Network",
      "type": "int",
      "default": "3600*24",
      "desc": "api http session timeout"
    },
    {
      "key": "net_http_api_auth_bearer_token_enabled",
      "section": "Network",
      "type": "boolean",
      "default": "false",
      "desc": "Enable api access control by Bearer token(of Authorization http header) - get access token from /user/loginGetToken."
    },
    {
      "key": "net_http_api_gzip_enabled",
      "section": "Network",
      "type": "boolean",
      "default": "true",
      "desc": "Enable gzip response on api call"
    },
    {
      "key": "net_http_api_allow_ips",
      "section": "Network",
      "type": "String",
      "default": "localhost,127.0.0.1,0:0:0:0:0:0:0:1,::1",
      "desc": "api access allow ip addresses",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "allowIpExact",
      "section": "Network",
      "type": "Set<String>",
      "default": "",
      "desc": ""
    },
    {
      "key": "allowIpMatch",
      "section": "Network",
      "type": "List<StrMatch>",
      "default": "",
      "desc": ""
    },
    {
      "key": "db_dir",
      "section": "Dir",
      "type": "String",
      "default": "./database",
      "desc": "Store directory of database"
    },
    {
      "key": "log_dir",
      "section": "Dir",
      "type": "String",
      "default": "./logs",
      "desc": "Path to log directory"
    },
    {
      "key": "plugin_dir",
      "section": "Dir",
      "type": "String",
      "default": "./plugin",
      "desc": "Path to plugin directory"
    },
    {
      "key": "client_dir",
      "section": "Dir",
      "type": "String",
      "default": "./client",
      "desc": "Path to client related directory"
    },
    {
      "key": "temp_dir",
      "section": "Dir",
      "type": "String",
      "default": "./tempdata",
      "desc": "temp dir"
    },
    {
      "key": "object_deadtime_ms",
      "section": "Object",
      "type": "int",
      "default": "8000",
      "desc": "Waiting time(ms) until stopped heartbeat of object is determined to be inactive"
    },
    {
      "key": "object_inactive_alert_level",
      "section": "Object",
      "type": "int",
      "default": "0",
      "desc": "inactive object warning level. default 0.(0:info, 1:warn, 2:error, 3:fatal)"
    },
    {
      "key": "object_zipkin_deadtime_ms",
      "section": "Object",
      "type": "int",
      "default": "180 * 1000",
      "desc": "Zipkin Waiting time(ms) until stopped heartbeat of object is determined to be inactive"
    },
    {
      "key": "compress_xlog_enabled",
      "section": "Compress",
      "type": "boolean",
      "default": "false",
      "desc": "Activating XLog data in zip file"
    },
    {
      "key": "compress_profile_enabled",
      "section": "Compress",
      "type": "boolean",
      "default": "false",
      "desc": "Activating profile data in zip file"
    },
    {
      "key": "_compress_write_buffer_block_count",
      "section": "Compress",
      "type": "int",
      "default": "3",
      "desc": ""
    },
    {
      "key": "_compress_read_cache_block_count",
      "section": "Compress",
      "type": "int",
      "default": "3",
      "desc": ""
    },
    {
      "key": "_compress_read_cache_expired_ms",
      "section": "Compress",
      "type": "long",
      "default": "DateUtil.MILLIS_PER_MINUTE",
      "desc": ""
    },
    {
      "key": "_compress_dailycount_header_cache_size",
      "section": "Compress",
      "type": "int",
      "default": "3",
      "desc": ""
    },
    {
      "key": "_compress_write_thread",
      "section": "Compress",
      "type": "int",
      "default": "2",
      "desc": ""
    },
    {
      "key": "_auto_5m_sampling",
      "section": "Auto",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "mgr_purge_enabled",
      "section": "Manager",
      "type": "boolean",
      "default": "true",
      "desc": "Activating automatic deletion function in the database"
    },
    {
      "key": "mgr_purge_disk_usage_pct",
      "section": "Manager",
      "type": "int",
      "default": "80",
      "desc": "Condition of disk usage for automatic deletion. if lack, delete profile data first exclude today data."
    },
    {
      "key": "mgr_purge_profile_keep_days",
      "section": "Manager",
      "type": "int",
      "default": "10",
      "desc": "Retaining date for automatic deletion. delete profile data first."
    },
    {
      "key": "mgr_purge_keep_days",
      "section": "Manager",
      "type": "int",
      "default": "mgr_purge_profile_keep_days",
      "desc": "Deprecated : use mgr_purge_profile_keep_days"
    },
    {
      "key": "mgr_purge_xlog_keep_days",
      "section": "Manager",
      "type": "int",
      "default": "30",
      "desc": "Retaining date for automatic deletion."
    },
    {
      "key": "mgr_purge_xlog_without_profile_keep_days",
      "section": "Manager",
      "type": "int",
      "default": "mgr_purge_xlog_keep_days",
      "desc": "Deprecated : use mgr_purge_xlog_keep_days"
    },
    {
      "key": "mgr_purge_counter_keep_days",
      "section": "Manager",
      "type": "int",
      "default": "70",
      "desc": "Retaining date for automatic deletion"
    },
    {
      "key": "mgr_purge_realtime_counter_keep_days",
      "section": "Manager",
      "type": "int",
      "default": "mgr_purge_counter_keep_days",
      "desc": "Retaining date for automatic deletion. realtime-counter only."
    },
    {
      "key": "mgr_purge_tag_counter_keep_days",
      "section": "Manager",
      "type": "int",
      "default": "mgr_purge_counter_keep_days",
      "desc": "Retaining date for automatic deletion. tag-counter only."
    },
    {
      "key": "mgr_purge_visitor_counter_keep_days",
      "section": "Manager",
      "type": "int",
      "default": "mgr_purge_counter_keep_days",
      "desc": "Retaining date for automatic deletion. visitor-counter only"
    },
    {
      "key": "mgr_purge_daily_text_days",
      "section": "Manager",
      "type": "int",
      "default": "Math.max(mgr_purge_tag_counter_keep_days * 2, mgr_purge_xlog_keep_days * 2)",
      "desc": "Retaining date for automatic deletion. daily text dictionary only"
    },
    {
      "key": "mgr_purge_sum_data_days",
      "section": "Manager",
      "type": "int",
      "default": "60",
      "desc": "Retaining date for automatic deletion. summary(stat) data only"
    },
    {
      "key": "mgr_log_ignore_ids",
      "section": "Manager",
      "type": "StringSet",
      "default": "new StringSet()",
      "desc": "Ignored log ID set",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "mgr_text_db_daily_service_enabled",
      "section": "db",
      "type": "boolean",
      "default": "false",
      "desc": "true for daily dictionary mode about service name. default value is false that means it's permanent."
    },
    {
      "key": "mgr_text_db_daily_api_enabled",
      "section": "db",
      "type": "boolean",
      "default": "false",
      "desc": "true for daily dictionary mode about api name. default value is false that means it's permanent."
    },
    {
      "key": "mgr_text_db_daily_ua_enabled",
      "section": "db",
      "type": "boolean",
      "default": "false",
      "desc": "true for daily dictionary mode about user agent. default value is false that means it's permanent."
    },
    {
      "key": "_mgr_text_db_index_default_mb",
      "section": "db",
      "type": "int",
      "default": "1",
      "desc": "change default memory size of hash index.(MB)[warn] modified this will break the database files.\nbackup old database files before change values.(restart required)"
    },
    {
      "key": "_mgr_text_db_index_service_mb",
      "section": "db",
      "type": "int",
      "default": "1",
      "desc": "change memory size of hash index for service text.(MB)[warn] modified this will break the database files.\nbackup old database files before change values.(restart required)"
    },
    {
      "key": "_mgr_text_db_index_api_mb",
      "section": "db",
      "type": "int",
      "default": "1",
      "desc": "change memory size of hash index for apicall text.(MB)[warn] modified this will break the database files.\nbackup old database files before change values.(restart required)"
    },
    {
      "key": "_mgr_text_db_index_ua_mb",
      "section": "db",
      "type": "int",
      "default": "1",
      "desc": "change memory size of hash index for user agent text.(MB)[warn] modified this will break the database files.\nbackup old database files before change values.(restart required)"
    },
    {
      "key": "_mgr_text_db_index_login_mb",
      "section": "db",
      "type": "int",
      "default": "1",
      "desc": "change memory size of hash index for login text.(MB)[warn] modified this will break the database files.\nbackup old database files before change values.(restart required)"
    },
    {
      "key": "_mgr_text_db_index_desc_mb",
      "section": "db",
      "type": "int",
      "default": "1",
      "desc": "change memory size of hash index for desc text.(MB)[warn] modified this will break the database files.\nbackup old database files before change values.(restart required)"
    },
    {
      "key": "_mgr_text_db_index_hmsg_mb",
      "section": "db",
      "type": "int",
      "default": "1",
      "desc": "change memory size of hash index for hashed message text.(MB)[warn] modified this will break the database files.\nbackup old database files before change values.(restart required)"
    },
    {
      "key": "_mgr_text_db_daily_index_mb",
      "section": "db",
      "type": "int",
      "default": "1",
      "desc": "change memory size of hash index for daily text db.(MB)[warn] modified this will break the database files.\nbackup old database files before change values.(restart required)"
    },
    {
      "key": "_mgr_kv_store_index_default_mb",
      "section": "db",
      "type": "int",
      "default": "8",
      "desc": "change default memory size of key value store index.(MB)[warn] modified this will break the database files.\nbackup old database files before change values.(restart required)"
    },
    {
      "key": "_mgr_xlog_id_index_mb",
      "section": "db",
      "type": "int",
      "default": "1",
      "desc": "change default memory size of xlog txid/gxid index.(MB)[warn] modified this will break the database files.\nbackup old database files before change values.(restart required)"
    },
    {
      "key": "ext_link_name",
      "section": "external-link",
      "type": "String",
      "default": "scouter-paper",
      "desc": "name of 3rd party ui"
    },
    {
      "key": "ext_link_url_pattern",
      "section": "external-link",
      "type": "String",
      "default": "http://my-scouter-paper-ip:6188/index.html#/paper?&address=localhost&port=6188&realtime=false&xlogElapsedTime=8000&instances=$[objHashes]&from=$[from]&to=$[to]&layout=my-layout-template-01",
      "desc": "outgoing link pattern for a 3rd party UI.(client restart required)\nContext menu in any chart shows the menu 'Open with 3rd-party UI.'\n* variable patterns : \n   $[objHashes] : comma separated objHash values\n   $[objType] : object type\n   $[from] : start time in chart by millis\n   $[to] : end time in chart by millis"
    },
    {
      "key": "span_queue_size",
      "section": "Span",
      "type": "int",
      "default": "1000",
      "desc": "Span Queue Size"
    },
    {
      "key": "xlog_queue_size",
      "section": "XLog",
      "type": "int",
      "default": "10000",
      "desc": "XLog Writer Queue Size"
    },
    {
      "key": "xlog_realtime_lower_bound_ms",
      "section": "XLog",
      "type": "int",
      "default": "0",
      "desc": "Ignored time(ms) in retrieving XLog in real time"
    },
    {
      "key": "xlog_pasttime_lower_bound_ms",
      "section": "XLog",
      "type": "int",
      "default": "0",
      "desc": "Ignored time(ms) in retrieving previous XLog"
    },
    {
      "key": "profile_queue_size",
      "section": "Profile",
      "type": "int",
      "default": "1000",
      "desc": "Profile Writer Queue Size"
    },
    {
      "key": "xlog_sampling_matcher_gxid_keep_memory_count",
      "section": "Profile",
      "type": "int",
      "default": "500000",
      "desc": "gxid keeping count in memory for XLog consequent sampling"
    },
    {
      "key": "xlog_sampling_matcher_xlog_keep_memory_count",
      "section": "Profile",
      "type": "int",
      "default": "100000",
      "desc": "xlog keeping count in memory for XLog consequent sampling"
    },
    {
      "key": "xlog_sampling_matcher_xlog_keep_memory_millis",
      "section": "Profile",
      "type": "int",
      "default": "5000",
      "desc": "max keeping millis of xlog for XLog consequent sampling"
    },
    {
      "key": "xlog_sampling_matcher_profile_keep_memory_count",
      "section": "Profile",
      "type": "int",
      "default": "5000",
      "desc": "profile keeping count (in one bucket, 500ms) in memory for XLog consequent sampling"
    },
    {
      "key": "xlog_sampling_matcher_profile_keep_memory_secs",
      "section": "Profile",
      "type": "int",
      "default": "5",
      "desc": "max keeping seconds of profile for XLog consequent sampling"
    },
    {
      "key": "geoip_enabled",
      "section": "GeoIP",
      "type": "boolean",
      "default": "true",
      "desc": "Activating IP-based city/country extraction"
    },
    {
      "key": "geoip_data_city_file",
      "section": "GeoIP",
      "type": "String",
      "default": "CONF_DIR + \"GeoLiteCity.dat\"",
      "desc": "Path to GeoIP data file"
    },
    {
      "key": "sql_table_parsing_enabled",
      "section": "SQL",
      "type": "boolean",
      "default": "true",
      "desc": "Activating table-based SQL compression"
    },
    {
      "key": "tagcnt_enabled",
      "section": "TagCount",
      "type": "boolean",
      "default": "true",
      "desc": "Activating TagCount function"
    },
    {
      "key": "req_search_xlog_max_count",
      "section": "Service request options from client",
      "type": "int",
      "default": "500",
      "desc": "search xlog service option - max xlog count to search per request"
    },
    {
      "key": "input_telegraf_config_file",
      "section": "Service request options from client",
      "type": "String",
      "default": "CONF_DIR + \"scouter-telegraf.xml\"",
      "desc": "Path to telegraf config xml file"
    },
    {
      "key": "input_telegraf_enabled",
      "section": "Service request options from client",
      "type": "boolean",
      "default": "true",
      "desc": "Deprecated use the telegraf config view instead. This value may be ignored."
    },
    {
      "key": "input_telegraf_debug_enabled",
      "section": "Service request options from client",
      "type": "boolean",
      "default": "false",
      "desc": "Deprecated use the telegraf config view instead. This value may be ignored."
    },
    {
      "key": "input_telegraf_delta_counter_normalize_default",
      "section": "Service request options from client",
      "type": "boolean",
      "default": "true",
      "desc": "Deprecated use the telegraf config view instead. This value may be ignored."
    },
    {
      "key": "input_telegraf_delta_counter_normalize_default_seconds",
      "section": "Service request options from client",
      "type": "int",
      "default": "30",
      "desc": "Deprecated use the telegraf config view instead. This value may be ignored."
    },
    {
      "key": "telegraf_object_deadtime_ms",
      "section": "Service request options from client",
      "type": "int",
      "default": "35000",
      "desc": "Deprecated use the telegraf config view instead. This value may be ignored."
    },
    {
      "key": "input_telegraf_$measurement$_enabled",
      "section": "Service request options from client",
      "type": "boolean",
      "default": "true",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\nTelegraf http input of the $measurement$ enabled.\n$measurement$ is a variable to the measurement name of the line protocol.\neg) input_telegraf_$redis_keyspace$_enabled=true"
    },
    {
      "key": "input_telegraf_$measurement$_debug_enabled",
      "section": "Service request options from client",
      "type": "boolean",
      "default": "false",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\nprint telegraf line protocol of the $measurement$ to STDOUT"
    },
    {
      "key": "input_telegraf_$measurement$_tag_filter",
      "section": "Service request options from client",
      "type": "String",
      "default": "",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\nIf set, only the metric matching to this tag value is handled.\nIt can have multiple values. comma separator means 'or' condition. eg) cpu:cpu-total,cpu:cpu0\nIt also have not(!) condition. eg) cpu:!cpu-total",
      "valueType": "COMMA_COLON_SEPARATED_VALUE"
    },
    {
      "key": "input_telegraf_$measurement$_counter_mappings",
      "section": "Service request options from client",
      "type": "String",
      "default": "",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\nwhich fields of $measurement$ are mapped to scouter's counter.\nformat: {line-protocol field name}:{scouter counter name}:{display name?}:{unit?}:{hasTotal?}:{normalize sec?}\nIt can have multiple values.\n - {scouter counter name} can be defined in combination with the line protocol's tag variables.\nFor example, if the value of 'tag1' is 'disk01' and the value of 'tag2' is 'bin', the counter name defined as 'scouter-du-$tag1$-$tag2$' is 'scouter-du-disk01-bin'.\n eg)used_memory:tg-redis-used-memory,used_memory_rss:redis-used-memory-rss,redis used rss,bytes:true\n eg)cpu:cpu-$cpu-no$ -- this example shows counter definition with tag value.\nIf {line-protocol field name} is started with '&' or '&&', then It works as delta counter\nWhen specified as a delta type, the difference in values per second is stored. and the counter name ends with '_delta'\ndouble '&&' means BOTH type. AS BOTH type, the value and the difference value both are stored.\n - {normalize sec} applies only to a delta counter if the counter is a 'BOTH' type counter. (This value can have min 4 to max 60)",
      "valueType": "COMMA_COLON_SEPARATED_VALUE"
    },
    {
      "key": "input_telegraf_$measurement$_objFamily_base",
      "section": "Service request options from client",
      "type": "String",
      "default": "",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\ndefine an obj Family prefix. objectType is defined with some tags.\nsee input_telegraf_$measurement$_objFamily_append_tags option."
    },
    {
      "key": "input_telegraf_$measurement$_objFamily_append_tags",
      "section": "Service request options from client",
      "type": "String",
      "default": "",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\nthis tags's value is appended to objFamily_base.\nIt can have multiple values. eg)tag1,tag2",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "input_telegraf_$measurement$_objType_base",
      "section": "Service request options from client",
      "type": "String",
      "default": "",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\ndefine an objectType prefix. objectType is defined with some tags.\nsee input_telegraf_$measurement$_objType_prepend(or append)_tags option."
    },
    {
      "key": "input_telegraf_$measurement$_objType_prepend_tags",
      "section": "Service request options from client",
      "type": "String",
      "default": "scouter_obj_type_prefix",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\nthis tags's value is prepended to objType_base.\nIt can have multiple values. eg)tag1,tag2",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "input_telegraf_$measurement$_objType_append_tags",
      "section": "Service request options from client",
      "type": "String",
      "default": "",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\nthis tags's value is appended to objType_base.\nIt can have multiple values. eg)tag1,tag2",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "input_telegraf_$measurement$_objType_icon",
      "section": "Service request options from client",
      "type": "String",
      "default": "",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\nthis tags's value is object type's icon file name that the scouter client have. eg)redis"
    },
    {
      "key": "input_telegraf_$measurement$_objName_base",
      "section": "Service request options from client",
      "type": "String",
      "default": "",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\ndefine an objectName prefix. objectName is defined with some tags.\nsee input_telegraf_$measurement$_objName_append_tags option."
    },
    {
      "key": "input_telegraf_$measurement$_objName_append_tags",
      "section": "Service request options from client",
      "type": "String",
      "default": "",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\nthis tags's value is appended to objName_base.\nIt can have multiple values. eg)tag1,tag2",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "input_telegraf_$measurement$_host_tag",
      "section": "Service request options from client",
      "type": "String",
      "default": "host",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\ntag name to define host"
    },
    {
      "key": "input_telegraf_$measurement$_host_mappings",
      "section": "Service request options from client",
      "type": "String",
      "default": "",
      "desc": "[This option is just a sample. Change $measurement$ to your measurement name like $cpu$.]\nwhich host value defined with $measurement$_host_tag option is mapped to scouter's host.\nIt can have multiple values. eg)hostValue1:scouterHost1,hostValue2:scouterHost2",
      "valueType": "COMMA_COLON_SEPARATED_VALUE"
    },
    {
      "key": "visitor_hourly_count_enabled",
      "section": "Visitor Hourly",
      "type": "boolean",
      "default": "true",
      "desc": ""
    }
  ],
  "java": [
    {
      "key": "net_local_udp_ip",
      "section": "Network",
      "type": "String",
      "default": "null",
      "desc": "UDP local IP"
    },
    {
      "key": "net_local_udp_port",
      "section": "Network",
      "type": "int",
      "default": "",
      "desc": "UDP local Port"
    },
    {
      "key": "net_collector_ip",
      "section": "Network",
      "type": "String",
      "default": "127.0.0.1",
      "desc": "Collector IP"
    },
    {
      "key": "net_collector_udp_port",
      "section": "Network",
      "type": "int",
      "default": "NetConstants.SERVER_UDP_PORT",
      "desc": "Collector UDP Port"
    },
    {
      "key": "net_collector_tcp_port",
      "section": "Network",
      "type": "int",
      "default": "NetConstants.SERVER_TCP_PORT",
      "desc": "Collector TCP Port"
    },
    {
      "key": "net_collector_tcp_session_count",
      "section": "Network",
      "type": "int",
      "default": "1",
      "desc": "Collector TCP Session Count"
    },
    {
      "key": "net_collector_tcp_so_timeout_ms",
      "section": "Network",
      "type": "int",
      "default": "60000",
      "desc": "Collector TCP Socket Timeout(ms)"
    },
    {
      "key": "net_collector_tcp_connection_timeout_ms",
      "section": "Network",
      "type": "int",
      "default": "3000",
      "desc": "Collector TCP Connection Timeout(ms)"
    },
    {
      "key": "net_udp_packet_max_bytes",
      "section": "Network",
      "type": "int",
      "default": "60000",
      "desc": "UDP Buffer Size"
    },
    {
      "key": "net_udp_collection_interval_ms",
      "section": "Network",
      "type": "long",
      "default": "100",
      "desc": "UDP Collection Interval(ms)"
    },
    {
      "key": "obj_type",
      "section": "Object",
      "type": "String",
      "default": "",
      "desc": "Deprecated. It's just an alias of monitoring_group_type which overrides this value."
    },
    {
      "key": "monitoring_group_type",
      "section": "Object",
      "type": "String",
      "default": "",
      "desc": "monitoring group type, commonly named as system name and a monitoring type.\neg) ORDER-JVM, WAREHOUSE-LINUX ..."
    },
    {
      "key": "obj_name",
      "section": "Object",
      "type": "String",
      "default": "",
      "desc": "Object Name"
    },
    {
      "key": "obj_host_type",
      "section": "Object",
      "type": "String",
      "default": "",
      "desc": "Host Type"
    },
    {
      "key": "obj_host_name",
      "section": "Object",
      "type": "String",
      "default": "",
      "desc": "Host Name"
    },
    {
      "key": "obj_name_auto_pid_enabled",
      "section": "Object",
      "type": "boolean",
      "default": "false",
      "desc": "Activating for using object name as PID"
    },
    {
      "key": "obj_type_inherit_to_child_enabled",
      "section": "Object",
      "type": "boolean",
      "default": "false",
      "desc": "Redefining DS, RP type according to main object"
    },
    {
      "key": "jmx_counter_enabled",
      "section": "Object",
      "type": "boolean",
      "default": "false",
      "desc": "Activating collect sub counters using JMX"
    },
    {
      "key": "profile_http_querystring_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "",
      "desc": "Http Query String profile"
    },
    {
      "key": "profile_http_header_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "",
      "desc": "Http Header profile"
    },
    {
      "key": "profile_http_header_url_prefix",
      "section": "profile",
      "type": "String",
      "default": "/",
      "desc": "Service URL prefix for Http header profile"
    },
    {
      "key": "profile_http_header_keys",
      "section": "profile",
      "type": "String",
      "default": "",
      "desc": "http header names for profiling with comma separator",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "profile_http_parameter_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "",
      "desc": "Http Parameter profile"
    },
    {
      "key": "profile_http_parameter_url_prefix",
      "section": "profile",
      "type": "String",
      "default": "/",
      "desc": "Service URL prefix for Http parameter profile"
    },
    {
      "key": "profile_spring_controller_method_parameter_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "true",
      "desc": "spring controller method parameter profile"
    },
    {
      "key": "profile_thread_cputime_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "Profiling the memory usage of each method"
    },
    {
      "key": "profile_thread_memory_usage_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "true",
      "desc": "Profiling the memory usage of each service"
    },
    {
      "key": "profile_socket_open_fullstack_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "ThreadStack profile for open socket"
    },
    {
      "key": "profile_socket_open_fullstack_port",
      "section": "profile",
      "type": "int",
      "default": "0",
      "desc": "ThreadStack profile for a certain port of open socket"
    },
    {
      "key": "profile_sqlmap_name_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "true",
      "desc": "SQL Map profile"
    },
    {
      "key": "profile_connection_open_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "true",
      "desc": "DBConnection profile"
    },
    {
      "key": "profile_connection_open_fullstack_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "Activating stack information profile in opening DB connection"
    },
    {
      "key": "profile_connection_autocommit_status_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "AutoCommit profile"
    },
    {
      "key": "profile_method_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "true",
      "desc": "Method profile"
    },
    {
      "key": "profile_step_max_count",
      "section": "profile",
      "type": "int",
      "default": "1024",
      "desc": "Profile Buffer Size"
    },
    {
      "key": "profile_step_max_keep_in_memory_count",
      "section": "profile",
      "type": "int",
      "default": "2048",
      "desc": "Profile Buffer Size"
    },
    {
      "key": "profile_fullstack_service_error_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "Stack profile in occurrence of service error"
    },
    {
      "key": "profile_fullstack_apicall_error_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "Stack profile in occurrence of apicall error"
    },
    {
      "key": "profile_fullstack_sql_error_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "Stack profile in occurrence of sql error"
    },
    {
      "key": "profile_fullstack_sql_commit_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "Stack profile in occurrence of commit error"
    },
    {
      "key": "profile_fullstack_hooked_exception_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "Stack profile in occurrence of sql error"
    },
    {
      "key": "profile_fullstack_redis_error_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "Stack profile in occurrence of redis error"
    },
    {
      "key": "profile_redis_key_forcibly_stringify_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "make unknown redis key stringify by force. (using new String(byte[])"
    },
    {
      "key": "profile_fullstack_max_lines",
      "section": "profile",
      "type": "int",
      "default": "0",
      "desc": "Number of stack profile lines in occurrence of error"
    },
    {
      "key": "profile_sql_escape_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "true",
      "desc": "Escaping literal parameters for normalizing the query"
    },
    {
      "key": "_profile_fullstack_sql_connection_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "_profile_fullstack_sql_execute_debug_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "profile_fullstack_rs_leak_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "profile_fullstack_stmt_leak_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "profile_elasticsearch_full_query_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "Profile elastic search full query.\nIt need more payload and disk usage."
    },
    {
      "key": "profile_reactor_checkpoint_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "true",
      "desc": "profile reactor's important checkpoint"
    },
    {
      "key": "profile_reactor_more_checkpoint_enabled",
      "section": "profile",
      "type": "boolean",
      "default": "false",
      "desc": "profile reactor's another checkpoints"
    },
    {
      "key": "trace_user_mode",
      "section": "Trace",
      "type": "int",
      "default": "2",
      "desc": "User ID based(0 : Remote IP Address, 1 : Cookie(JSESSIONID), 2 : Cookie(SCOUTER), 3 : Header) \n - able to set value for 1.Cookie and 3.Header \n - refer to 'trace_user_session_key'"
    },
    {
      "key": "trace_scouter_cookie_max_age",
      "section": "Trace",
      "type": "int",
      "default": "Integer.MAX_VALUE",
      "desc": "Setting a cookie expired time for SCOUTER cookie when trace_user_mode is 2"
    },
    {
      "key": "trace_user_cookie_path",
      "section": "Trace",
      "type": "String",
      "default": "/",
      "desc": "Setting a cookie path for SCOUTER cookie when trace_user_mode is 2"
    },
    {
      "key": "trace_background_socket_enabled",
      "section": "Trace",
      "type": "boolean",
      "default": "true",
      "desc": "Tracing background thread socket"
    },
    {
      "key": "trace_service_name_header_key",
      "section": "Trace",
      "type": "String",
      "default": "",
      "desc": "Adding assigned header value to the service name"
    },
    {
      "key": "trace_service_name_get_key",
      "section": "Trace",
      "type": "String",
      "default": "",
      "desc": "Adding assigned get parameter to the service name"
    },
    {
      "key": "trace_service_name_post_key",
      "section": "Trace",
      "type": "String",
      "default": "",
      "desc": "Adding assigned post parameter to the service name"
    },
    {
      "key": "trace_activeserivce_yellow_time",
      "section": "Trace",
      "type": "long",
      "default": "3000",
      "desc": "Active Thread Warning Time(ms)"
    },
    {
      "key": "trace_activeservice_red_time",
      "section": "Trace",
      "type": "long",
      "default": "8000",
      "desc": "Active Thread Fatal Time(ms)"
    },
    {
      "key": "trace_http_client_ip_header_key",
      "section": "Trace",
      "type": "String",
      "default": "",
      "desc": "Identifying header key of Remote IP"
    },
    {
      "key": "trace_interservice_enabled",
      "section": "Trace",
      "type": "boolean",
      "default": "true",
      "desc": "Activating gxid connection in HttpTransfer"
    },
    {
      "key": "_trace_interservice_gxid_header_key",
      "section": "Trace",
      "type": "String",
      "default": "X-Scouter-Gxid",
      "desc": ""
    },
    {
      "key": "trace_response_gxid_enabled",
      "section": "Trace",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "_trace_interservice_callee_header_key",
      "section": "Trace",
      "type": "String",
      "default": "X-Scouter-Callee",
      "desc": ""
    },
    {
      "key": "_trace_interservice_caller_header_key",
      "section": "Trace",
      "type": "String",
      "default": "X-Scouter-Caller",
      "desc": ""
    },
    {
      "key": "_trace_interservice_caller_obj_header_key",
      "section": "Trace",
      "type": "String",
      "default": "X-Scouter-Caller-Obj",
      "desc": ""
    },
    {
      "key": "_trace_interservice_callee_obj_header_key",
      "section": "Trace",
      "type": "String",
      "default": "X-Scouter-Callee-Obj",
      "desc": ""
    },
    {
      "key": "trace_user_session_key",
      "section": "Trace",
      "type": "String",
      "default": "JSESSIONID",
      "desc": "JSession key for user ID"
    },
    {
      "key": "_trace_auto_service_enabled",
      "section": "Trace",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "_trace_auto_service_backstack_enabled",
      "section": "Trace",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "trace_db2_enabled",
      "section": "Trace",
      "type": "boolean",
      "default": "true",
      "desc": "Activating trace DB2"
    },
    {
      "key": "trace_webserver_enabled",
      "section": "Trace",
      "type": "boolean",
      "default": "false",
      "desc": "Deprecated!"
    },
    {
      "key": "trace_webserver_name_header_key",
      "section": "Trace",
      "type": "String",
      "default": "X-Forwarded-Host",
      "desc": "Deprecated!"
    },
    {
      "key": "trace_webserver_time_header_key",
      "section": "Trace",
      "type": "String",
      "default": "X-Forwarded-Time",
      "desc": "Deprecated!"
    },
    {
      "key": "trace_request_queuing_enabled",
      "section": "Trace",
      "type": "boolean",
      "default": "false",
      "desc": "measure queuing time from load balancer, reverse proxy, web server...\n if set, you can open Queuing Time view."
    },
    {
      "key": "trace_request_queuing_start_host_header",
      "section": "Trace",
      "type": "String",
      "default": "X-Request-Start-Host",
      "desc": "the name of server that set request start time"
    },
    {
      "key": "trace_request_queuing_start_time_header",
      "section": "Trace",
      "type": "String",
      "default": "X-Request-Start-Time",
      "desc": "set request start time.\n - time format : t=microsecond (or) ts=second.milli"
    },
    {
      "key": "trace_request_queuing_start_2nd_host_header",
      "section": "Trace",
      "type": "String",
      "default": "X-Request-Start-2nd-Host",
      "desc": "the name of server that set the trace_request_queuing_start_2nd_time_header"
    },
    {
      "key": "trace_request_queuing_start_2nd_time_header",
      "section": "Trace",
      "type": "String",
      "default": "X-Request-Start-2nd-Time",
      "desc": "set request passing time measured by 2nd layered server.\n - time format : t=microsecond (or) ts=second.milli"
    },
    {
      "key": "_trace_fullstack_socket_open_port",
      "section": "Trace",
      "type": "int",
      "default": "0",
      "desc": ""
    },
    {
      "key": "_trace_sql_parameter_max_count",
      "section": "Trace",
      "type": "int",
      "default": "128",
      "desc": ""
    },
    {
      "key": "trace_sql_parameter_max_length",
      "section": "Trace",
      "type": "int",
      "default": "20",
      "desc": "max length of bound sql parameter on profile view(< 500)"
    },
    {
      "key": "trace_delayed_service_mgr_filename",
      "section": "Trace",
      "type": "String",
      "default": "setting_delayed_service.properties",
      "desc": ""
    },
    {
      "key": "trace_rs_leak_enabled",
      "section": "Trace",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "trace_stmt_leak_enabled",
      "section": "Trace",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "plugin_dir",
      "section": "Dir",
      "type": "File",
      "default": "new File(agent_dir_path + \"/plugin\")",
      "desc": "Plugin directory"
    },
    {
      "key": "dump_dir",
      "section": "Dir",
      "type": "File",
      "default": "new File(agent_dir_path + \"/dump\")",
      "desc": "Dump directory"
    },
    {
      "key": "mgr_static_content_extensions",
      "section": "Manager",
      "type": "String",
      "default": "js, htm, html, gif, png, jpg, css",
      "desc": "",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "mgr_log_ignore_ids",
      "section": "Manager",
      "type": "String",
      "default": "",
      "desc": "",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "autodump_enabled",
      "section": "Auto dump options when active service is exceed the set threshold count.",
      "type": "boolean",
      "default": "false",
      "desc": "Activating auto dump - append dumps onto the dump file in dump directory."
    },
    {
      "key": "autodump_trigger_active_service_cnt",
      "section": "Auto dump options when active service is exceed the set threshold count.",
      "type": "int",
      "default": "10000",
      "desc": "Auto dump trigger point (dump when exceeding this active service count)"
    },
    {
      "key": "autodump_interval_ms",
      "section": "Auto dump options when active service is exceed the set threshold count.",
      "type": "long",
      "default": "30000",
      "desc": "Minimum interval(ms) for operating auto dump function - hard min : 5000"
    },
    {
      "key": "autodump_level",
      "section": "Auto dump options when active service is exceed the set threshold count.",
      "type": "int",
      "default": "1",
      "desc": "Auto dump level (1 : ThreadDump, 2 : active service, 3 : thread list)"
    },
    {
      "key": "autodump_stuck_thread_ms",
      "section": "Auto dump options about the thread on stuck",
      "type": "int",
      "default": "0",
      "desc": "Dump when a thread are running over this time - 0 is disabled"
    },
    {
      "key": "autodump_stuck_check_interval_ms",
      "section": "Auto dump options about the thread on stuck",
      "type": "int",
      "default": "10000",
      "desc": ""
    },
    {
      "key": "autodump_cpu_exceeded_enabled",
      "section": "Auto dump options on exceeded process cpu",
      "type": "boolean",
      "default": "false",
      "desc": "Enable the function to generate dump file when this process cpu is over than the set threshold"
    },
    {
      "key": "autodump_cpu_exceeded_threshold_pct",
      "section": "Auto dump options on exceeded process cpu",
      "type": "int",
      "default": "90",
      "desc": "Threshold of cpu to generate dump file"
    },
    {
      "key": "autodump_cpu_exceeded_duration_ms",
      "section": "Auto dump options on exceeded process cpu",
      "type": "int",
      "default": "30000",
      "desc": "Threshold of over-cpu-threshold duration"
    },
    {
      "key": "autodump_cpu_exceeded_dump_interval_ms",
      "section": "Auto dump options on exceeded process cpu",
      "type": "int",
      "default": "3000",
      "desc": "Dump file generation interval"
    },
    {
      "key": "autodump_cpu_exceeded_dump_cnt",
      "section": "Auto dump options on exceeded process cpu",
      "type": "int",
      "default": "3",
      "desc": "value of how many dump is generated."
    },
    {
      "key": "xlog_lower_bound_time_ms",
      "section": "XLog",
      "type": "int",
      "default": "0",
      "desc": "(deprecated) XLog Ignore Time\n - for backward compatibility. Use xlog_sampling_xxx options instead"
    },
    {
      "key": "xlog_error_jdbc_fetch_max",
      "section": "XLog error marking",
      "type": "int",
      "default": "10000",
      "desc": "Leave an error message at XLog in case of over fetching. (fetch count)"
    },
    {
      "key": "xlog_error_sql_time_max_ms",
      "section": "XLog error marking",
      "type": "int",
      "default": "30000",
      "desc": "Leave an error message at XLog in case of over timing query. (ms)"
    },
    {
      "key": "xlog_error_check_user_transaction_enabled",
      "section": "XLog error marking",
      "type": "boolean",
      "default": "true",
      "desc": "Leave an error message at XLog when UserTransaction's begin/end unpaired"
    },
    {
      "key": "xlog_error_on_sqlexception_enabled",
      "section": "XLog error marking",
      "type": "boolean",
      "default": "true",
      "desc": "mark as error on xlog flag if SqlException is occured."
    },
    {
      "key": "xlog_error_on_apicall_exception_enabled",
      "section": "XLog error marking",
      "type": "boolean",
      "default": "true",
      "desc": "mark as error on xlog flag if Api call errors are occured."
    },
    {
      "key": "xlog_error_on_redis_exception_enabled",
      "section": "XLog error marking",
      "type": "boolean",
      "default": "true",
      "desc": "mark as error on xlog flag if redis error is occured."
    },
    {
      "key": "xlog_error_on_elasticsearch_exception_enabled",
      "section": "XLog error marking",
      "type": "boolean",
      "default": "true",
      "desc": "mark as error on xlog flag if elasticsearc error is occured."
    },
    {
      "key": "xlog_error_on_mongodb_exception_enabled",
      "section": "XLog error marking",
      "type": "boolean",
      "default": "true",
      "desc": "mark as error on xlog flag if mongodb error is occured."
    },
    {
      "key": "_xlog_hard_sampling_enabled",
      "section": "XLog hard sampling options",
      "type": "boolean",
      "default": "false",
      "desc": "XLog hard sampling mode enabled\n - for the best performance but it affects all statistics data"
    },
    {
      "key": "_xlog_hard_sampling_rate_pct",
      "section": "XLog hard sampling options",
      "type": "int",
      "default": "10",
      "desc": "XLog hard sampling rate(%) - discard data over the percentage"
    },
    {
      "key": "ignore_global_consequent_sampling",
      "section": "XLog soft sampling options",
      "type": "boolean",
      "default": "false",
      "desc": "XLog sampling - ignore global consequent sampling. the commencement service's sampling option affects it's children."
    },
    {
      "key": "xlog_consequent_sampling_ignore_patterns",
      "section": "XLog soft sampling options",
      "type": "String",
      "default": "",
      "desc": "XLog sampling - The service of this patterns can be unsampled by the sampling rate even if parent call is sampled and on tracing."
    },
    {
      "key": "xlog_sampling_exclude_patterns",
      "section": "XLog soft sampling options",
      "type": "String",
      "default": "",
      "desc": "XLog sampling exclude patterns."
    },
    {
      "key": "xlog_sampling_enabled",
      "section": "XLog soft sampling options",
      "type": "boolean",
      "default": "false",
      "desc": "XLog sampling mode enabled"
    },
    {
      "key": "xlog_sampling_only_profile",
      "section": "XLog soft sampling options",
      "type": "boolean",
      "default": "false",
      "desc": "XLog sampling but discard profile only not XLog."
    },
    {
      "key": "xlog_sampling_step1_ms",
      "section": "XLog soft sampling options",
      "type": "int",
      "default": "100",
      "desc": "XLog sampling bound millisecond - step1(lowest : range - from 0 to here)"
    },
    {
      "key": "xlog_sampling_step1_rate_pct",
      "section": "XLog soft sampling options",
      "type": "int",
      "default": "3",
      "desc": "XLog sampling step1 percentage(%)"
    },
    {
      "key": "xlog_sampling_step2_ms",
      "section": "XLog soft sampling options",
      "type": "int",
      "default": "1000",
      "desc": "XLog sampling bound millisecond - step2(range - from step1 to here)"
    },
    {
      "key": "xlog_sampling_step2_rate_pct",
      "section": "XLog soft sampling options",
      "type": "int",
      "default": "10",
      "desc": "XLog sampling step2 percentage(%)"
    },
    {
      "key": "xlog_sampling_step3_ms",
      "section": "XLog soft sampling options",
      "type": "int",
      "default": "3000",
      "desc": "XLog sampling bound millisecond - step3(highest : range - from step2 to here)"
    },
    {
      "key": "xlog_sampling_step3_rate_pct",
      "section": "XLog soft sampling options",
      "type": "int",
      "default": "30",
      "desc": "XLog sampling step3 percentage(%)"
    },
    {
      "key": "xlog_sampling_over_rate_pct",
      "section": "XLog soft sampling options",
      "type": "int",
      "default": "100",
      "desc": "XLog sampling over step3 percentage(%)"
    },
    {
      "key": "xlog_patterned_sampling_enabled",
      "section": "XLog sampling for service patterns options",
      "type": "boolean",
      "default": "false",
      "desc": "XLog patterned sampling mode enabled"
    },
    {
      "key": "xlog_patterned_sampling_service_patterns",
      "section": "XLog sampling for service patterns options",
      "type": "String",
      "default": "",
      "desc": "XLog patterned sampling service patterns\neg) /user/{userId}<GET>,/device/*",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "xlog_patterned_sampling_only_profile",
      "section": "XLog sampling for service patterns options",
      "type": "boolean",
      "default": "false",
      "desc": "XLog patterned sampling but discard profile only not XLog."
    },
    {
      "key": "xlog_patterned_sampling_step1_ms",
      "section": "XLog sampling for service patterns options",
      "type": "int",
      "default": "100",
      "desc": "XLog patterned sampling bound millisecond - step1(lowest : range - from 0 to here)"
    },
    {
      "key": "xlog_patterned_sampling_step1_rate_pct",
      "section": "XLog sampling for service patterns options",
      "type": "int",
      "default": "3",
      "desc": "XLog patterned sampling step1 percentage(%)"
    },
    {
      "key": "xlog_patterned_sampling_step2_ms",
      "section": "XLog sampling for service patterns options",
      "type": "int",
      "default": "1000",
      "desc": "XLog patterned sampling bound millisecond - step2(range - from step1 to here)"
    },
    {
      "key": "xlog_patterned_sampling_step2_rate_pct",
      "section": "XLog sampling for service patterns options",
      "type": "int",
      "default": "10",
      "desc": "XLog patterned sampling step2 percentage(%)"
    },
    {
      "key": "xlog_patterned_sampling_step3_ms",
      "section": "XLog sampling for service patterns options",
      "type": "int",
      "default": "3000",
      "desc": "XLog patterned sampling bound millisecond - step3(highest : range - from step2 to here)"
    },
    {
      "key": "xlog_patterned_sampling_step3_rate_pct",
      "section": "XLog sampling for service patterns options",
      "type": "int",
      "default": "30",
      "desc": "XLog patterned sampling step3 percentage(%)"
    },
    {
      "key": "xlog_patterned_sampling_over_rate_pct",
      "section": "XLog sampling for service patterns options",
      "type": "int",
      "default": "100",
      "desc": "XLog patterned sampling over step3 percentage(%)"
    },
    {
      "key": "xlog_patterned2_sampling_enabled",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "boolean",
      "default": "false",
      "desc": "XLog patterned sampling mode enabled"
    },
    {
      "key": "xlog_patterned2_sampling_service_patterns",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "String",
      "default": "",
      "desc": "XLog patterned sampling service patterns\neg) /user/{userId}<GET>,/device/*",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "xlog_patterned2_sampling_only_profile",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "boolean",
      "default": "false",
      "desc": "XLog patterned sampling but discard profile only not XLog."
    },
    {
      "key": "xlog_patterned2_sampling_step1_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "100",
      "desc": "XLog patterned sampling bound millisecond - step1(lowest : range - from 0 to here)"
    },
    {
      "key": "xlog_patterned2_sampling_step1_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "3",
      "desc": "XLog patterned sampling step1 percentage(%)"
    },
    {
      "key": "xlog_patterned2_sampling_step2_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "1000",
      "desc": "XLog patterned sampling bound millisecond - step2(range - from step1 to here)"
    },
    {
      "key": "xlog_patterned2_sampling_step2_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "10",
      "desc": "XLog patterned sampling step2 percentage(%)"
    },
    {
      "key": "xlog_patterned2_sampling_step3_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "3000",
      "desc": "XLog patterned sampling bound millisecond - step3(highest : range - from step2 to here)"
    },
    {
      "key": "xlog_patterned2_sampling_step3_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "30",
      "desc": "XLog patterned sampling step3 percentage(%)"
    },
    {
      "key": "xlog_patterned2_sampling_over_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "100",
      "desc": "XLog patterned sampling over step3 percentage(%)"
    },
    {
      "key": "xlog_patterned3_sampling_enabled",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "boolean",
      "default": "false",
      "desc": "XLog patterned sampling mode enabled"
    },
    {
      "key": "xlog_patterned3_sampling_service_patterns",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "String",
      "default": "",
      "desc": "XLog patterned sampling service patterns\neg) /user/{userId}<GET>,/device/*",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "xlog_patterned3_sampling_only_profile",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "boolean",
      "default": "false",
      "desc": "XLog patterned sampling but discard profile only not XLog."
    },
    {
      "key": "xlog_patterned3_sampling_step1_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "100",
      "desc": "XLog patterned sampling bound millisecond - step1(lowest : range - from 0 to here)"
    },
    {
      "key": "xlog_patterned3_sampling_step1_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "3",
      "desc": "XLog patterned sampling step1 percentage(%)"
    },
    {
      "key": "xlog_patterned3_sampling_step2_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "1000",
      "desc": "XLog patterned sampling bound millisecond - step2(range - from step1 to here)"
    },
    {
      "key": "xlog_patterned3_sampling_step2_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "10",
      "desc": "XLog patterned sampling step2 percentage(%)"
    },
    {
      "key": "xlog_patterned3_sampling_step3_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "3000",
      "desc": "XLog patterned sampling bound millisecond - step3(highest : range - from step2 to here)"
    },
    {
      "key": "xlog_patterned3_sampling_step3_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "30",
      "desc": "XLog patterned sampling step3 percentage(%)"
    },
    {
      "key": "xlog_patterned3_sampling_over_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "100",
      "desc": "XLog patterned sampling over step3 percentage(%)"
    },
    {
      "key": "xlog_patterned4_sampling_enabled",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "boolean",
      "default": "false",
      "desc": "XLog patterned sampling mode enabled"
    },
    {
      "key": "xlog_patterned4_sampling_service_patterns",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "String",
      "default": "",
      "desc": "XLog patterned sampling service patterns\neg) /user/{userId}<GET>,/device/*",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "xlog_patterned4_sampling_only_profile",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "boolean",
      "default": "false",
      "desc": "XLog patterned sampling but discard profile only not XLog."
    },
    {
      "key": "xlog_patterned4_sampling_step1_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "100",
      "desc": "XLog patterned sampling bound millisecond - step1(lowest : range - from 0 to here)"
    },
    {
      "key": "xlog_patterned4_sampling_step1_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "3",
      "desc": "XLog patterned sampling step1 percentage(%)"
    },
    {
      "key": "xlog_patterned4_sampling_step2_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "1000",
      "desc": "XLog patterned sampling bound millisecond - step2(range - from step1 to here)"
    },
    {
      "key": "xlog_patterned4_sampling_step2_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "10",
      "desc": "XLog patterned sampling step2 percentage(%)"
    },
    {
      "key": "xlog_patterned4_sampling_step3_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "3000",
      "desc": "XLog patterned sampling bound millisecond - step3(highest : range - from step2 to here)"
    },
    {
      "key": "xlog_patterned4_sampling_step3_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "30",
      "desc": "XLog patterned sampling step3 percentage(%)"
    },
    {
      "key": "xlog_patterned4_sampling_over_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "100",
      "desc": "XLog patterned sampling over step3 percentage(%)"
    },
    {
      "key": "xlog_patterned5_sampling_enabled",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "boolean",
      "default": "false",
      "desc": "XLog patterned sampling mode enabled"
    },
    {
      "key": "xlog_patterned5_sampling_service_patterns",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "String",
      "default": "",
      "desc": "XLog patterned sampling service patterns\neg) /user/{userId}<GET>,/device/*",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "xlog_patterned5_sampling_only_profile",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "boolean",
      "default": "false",
      "desc": "XLog patterned sampling but discard profile only not XLog."
    },
    {
      "key": "xlog_patterned5_sampling_step1_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "100",
      "desc": "XLog patterned sampling bound millisecond - step1(lowest : range - from 0 to here)"
    },
    {
      "key": "xlog_patterned5_sampling_step1_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "3",
      "desc": "XLog patterned sampling step1 percentage(%)"
    },
    {
      "key": "xlog_patterned5_sampling_step2_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "1000",
      "desc": "XLog patterned sampling bound millisecond - step2(range - from step1 to here)"
    },
    {
      "key": "xlog_patterned5_sampling_step2_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "10",
      "desc": "XLog patterned sampling step2 percentage(%)"
    },
    {
      "key": "xlog_patterned5_sampling_step3_ms",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "3000",
      "desc": "XLog patterned sampling bound millisecond - step3(highest : range - from step2 to here)"
    },
    {
      "key": "xlog_patterned5_sampling_step3_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "30",
      "desc": "XLog patterned sampling step3 percentage(%)"
    },
    {
      "key": "xlog_patterned5_sampling_over_rate_pct",
      "section": "XLog patterned sampling options for another sampling group",
      "type": "int",
      "default": "100",
      "desc": "XLog patterned sampling over step3 percentage(%)"
    },
    {
      "key": "xlog_discard_service_patterns",
      "section": "XLog discard options",
      "type": "String",
      "default": "",
      "desc": "XLog discard service patterns\nNo XLog data, but apply to TPS and summary.\neg) /user/{userId}<GET>,/device/*",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "xlog_discard_service_show_error",
      "section": "XLog discard options",
      "type": "boolean",
      "default": "true",
      "desc": "Do not discard error even if it's discard pattern."
    },
    {
      "key": "xlog_fully_discard_service_patterns",
      "section": "XLog discard options",
      "type": "String",
      "default": "",
      "desc": "XLog fully discard service patterns\nNo XLog data, No apply to TPS and summary.\neg) /user/{userId}<GET>,/device/*",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "alert_message_length",
      "section": "Alert",
      "type": "int",
      "default": "3000",
      "desc": "Limited length of alert message"
    },
    {
      "key": "alert_send_interval_ms",
      "section": "Alert",
      "type": "long",
      "default": "10000",
      "desc": "Minimum interval(ms) in fetching the same alert"
    },
    {
      "key": "alert_perm_warning_pct",
      "section": "Alert",
      "type": "int",
      "default": "90",
      "desc": "PermGen usage for send alert"
    },
    {
      "key": "_log_asm_enabled",
      "section": "Log",
      "type": "boolean",
      "default": "",
      "desc": ""
    },
    {
      "key": "_log_udp_xlog_enabled",
      "section": "Log",
      "type": "boolean",
      "default": "",
      "desc": ""
    },
    {
      "key": "_log_udp_object_enabled",
      "section": "Log",
      "type": "boolean",
      "default": "",
      "desc": ""
    },
    {
      "key": "_log_udp_counter_enabled",
      "section": "Log",
      "type": "boolean",
      "default": "",
      "desc": ""
    },
    {
      "key": "_log_datasource_lookup_enabled",
      "section": "Log",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_log_background_sql",
      "section": "Log",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "log_dir",
      "section": "Log",
      "type": "String",
      "default": "",
      "desc": "Log directory"
    },
    {
      "key": "log_rotation_enabled",
      "section": "Log",
      "type": "boolean",
      "default": "true",
      "desc": "Retaining log according to date"
    },
    {
      "key": "log_keep_days",
      "section": "Log",
      "type": "int",
      "default": "7",
      "desc": "Keeping period of log"
    },
    {
      "key": "_trace",
      "section": "Log",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "_trace_use_logger",
      "section": "Log",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "hook_args_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for argument hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_return_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for return hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_constructor_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for constructor hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_connection_open_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for dbconnection hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_get_connection_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for getconnection hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_context_classes",
      "section": "Hook",
      "type": "String",
      "default": "javax/naming/InitialContext",
      "desc": "IntialContext Class Set",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_method_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for method hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_method_ignore_prefixes",
      "section": "Hook",
      "type": "String",
      "default": "get,set",
      "desc": "Prefix without Method hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_method_ignore_classes",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Class set without Method hookingt",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_method_exclude_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_method_access_public_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": "Activating public Method hooking"
    },
    {
      "key": "hook_method_access_private_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "false",
      "desc": "Activating private Method hooking"
    },
    {
      "key": "hook_method_access_protected_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "false",
      "desc": "Activating protected Method hooking"
    },
    {
      "key": "hook_method_access_none_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "false",
      "desc": "Activating none Method hooking"
    },
    {
      "key": "hook_method_lambda_enable",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": "Activating lambda Method hooking"
    },
    {
      "key": "hook_service_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for service hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_service_name_use_1st_string_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": "hooking service name use a 1st string parameter or class & method name"
    },
    {
      "key": "hook_apicall_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for apicall hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_apicall_info_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for apicallinfo hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_jsp_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for jsp hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_jdbc_pstmt_classes",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for preparestatement hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_jdbc_stmt_classes",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for statement hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_jdbc_rs_classes",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for resultset hooking",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_jdbc_wrapping_driver_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Method set for dbconnection wrapping",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_exception_class_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Exception class patterns - These will seem as error on xlog view.\n (ex) my.app.BizException,my.app.exception.*Exception",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_exception_exclude_class_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Exception class exclude patterns",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_exception_handler_method_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Exception handler patterns\n - exceptions passed to these methods are treated as error on xlog view.\n   (ex) my.app.myHandler.handleException",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_exception_handler_exclude_class_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "Exception handler exclude class name patterns(can not include star-* in patterns)\n - (ex) my.app.MyManagedException,MyBizException",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_async_servlet_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": "Hook for supporting async servlet"
    },
    {
      "key": "hook_async_servlet_start_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "startAsync impl. method patterns",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_async_context_dispatch_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "asyncContext dispatch impl. method patterns",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_spring_async_submit_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "spring async execution submit patterns",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_spring_async_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": "spring async execution hook enabled"
    },
    {
      "key": "hook_async_callrunnable_enable",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": "Deprecated. use hook_async_callrunnable_enabled"
    },
    {
      "key": "hook_async_callrunnable_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": "Hook callable and runnable for tracing async processing.\n It hook only 'hook_async_callrunnable_scan_prefixes' option contains pacakage or classes"
    },
    {
      "key": "hook_async_callrunnable_scan_package_prefixes",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "scanning range prefixes for hooking callable, runnable implementations and lambda expressions.\n usually your application package.\n 2 or more packages can be separated by commas.",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "_hook_redis_set_key_patterns",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": "redis key setting patterns.\n refer to org.springframework.data.redis.core.AbstractOperations#rawKey",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "hook_async_thread_pool_executor_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": "hook threadpool executor for tracing async processing."
    },
    {
      "key": "hook_hystrix_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "false",
      "desc": "hystrix execution hook enabled"
    },
    {
      "key": "hook_add_fields",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": ""
    },
    {
      "key": "_hook_serivce_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_dbsql_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_dbconn_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_cap_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_methods_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_apicall_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_socket_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_jsp_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_async_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_usertx_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_spring_rest_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_redis_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_kafka_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_elasticsearch_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "hook_mongodb_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "_hook_rabbit_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_reactive_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_coroutine_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "_hook_coroutine_debugger_hook_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "_hook_thread_name_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "_hook_direct_patch_classes",
      "section": "Hook",
      "type": "String",
      "default": "",
      "desc": ""
    },
    {
      "key": "_hook_boot_prefix",
      "section": "Hook",
      "type": "String",
      "default": "null",
      "desc": ""
    },
    {
      "key": "_hook_map_impl_enabled",
      "section": "Hook",
      "type": "boolean",
      "default": "false",
      "desc": "for warning a big Map type object that have a lot of entities.\n It may increase system load. be careful to enable this option."
    },
    {
      "key": "_hook_map_impl_warning_size",
      "section": "Hook",
      "type": "int",
      "default": "50000",
      "desc": ""
    },
    {
      "key": "control_reject_service_enabled",
      "section": "Control",
      "type": "boolean",
      "default": "false",
      "desc": "Activating Reject service"
    },
    {
      "key": "control_reject_service_max_count",
      "section": "Control",
      "type": "int",
      "default": "10000",
      "desc": "Minimum count of rejecting active service"
    },
    {
      "key": "control_reject_redirect_url_enabled",
      "section": "Control",
      "type": "boolean",
      "default": "false",
      "desc": "Activating Reject URL"
    },
    {
      "key": "control_reject_text",
      "section": "Control",
      "type": "String",
      "default": "too many request!!",
      "desc": "Reject Text"
    },
    {
      "key": "control_reject_redirect_url",
      "section": "Control",
      "type": "String",
      "default": "/error.html",
      "desc": "Reject URL"
    },
    {
      "key": "counter_enabled",
      "section": "Counter",
      "type": "boolean",
      "default": "true",
      "desc": "Activating collect counter"
    },
    {
      "key": "counter_recentuser_valid_ms",
      "section": "Counter",
      "type": "long",
      "default": "DateUtil.MILLIS_PER_FIVE_MINUTE",
      "desc": "think time (ms) of recent user"
    },
    {
      "key": "counter_object_registry_path",
      "section": "Counter",
      "type": "String",
      "default": "/tmp/scouter",
      "desc": "Path to file creation directory of process ID file"
    },
    {
      "key": "counter_custom_jmx_enabled",
      "section": "Counter",
      "type": "boolean",
      "default": "false",
      "desc": "Activating custom jmx"
    },
    {
      "key": "counter_interaction_enabled",
      "section": "Counter",
      "type": "boolean",
      "default": "false",
      "desc": "Activating interaction counter"
    },
    {
      "key": "sfa_dump_enabled",
      "section": "SFA(Stack Frequency Analyzer)",
      "type": "boolean",
      "default": "false",
      "desc": "Activating period threaddump function"
    },
    {
      "key": "sfa_dump_interval_ms",
      "section": "SFA(Stack Frequency Analyzer)",
      "type": "int",
      "default": "10000",
      "desc": "SFA thread dump Interval(ms)"
    },
    {
      "key": "_psts_enabled",
      "section": "PSTS(Preiodical Stacktrace Step)",
      "type": "boolean",
      "default": "false",
      "desc": "Activating periodical stacktrace step (write fixed interval thread dump on a profile)"
    },
    {
      "key": "_psts_dump_interval_ms",
      "section": "PSTS(Preiodical Stacktrace Step)",
      "type": "int",
      "default": "10000",
      "desc": "PSTS(periodical stacktrace step) thread dump Interval(ms) - hard min limit 2000"
    },
    {
      "key": "_psts_progressive_reactor_thread_trace_enabled",
      "section": "PSTS(Preiodical Stacktrace Step)",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "summary_enabled",
      "section": "Summary",
      "type": "boolean",
      "default": "true",
      "desc": "Activating summary function"
    },
    {
      "key": "_summary_connection_leak_fullstack_enabled",
      "section": "Summary",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "_summary_service_max_count",
      "section": "Summary",
      "type": "int",
      "default": "5000",
      "desc": ""
    },
    {
      "key": "_summary_sql_max_count",
      "section": "Summary",
      "type": "int",
      "default": "5000",
      "desc": ""
    },
    {
      "key": "_summary_api_max_count",
      "section": "Summary",
      "type": "int",
      "default": "5000",
      "desc": ""
    },
    {
      "key": "_summary_ip_max_count",
      "section": "Summary",
      "type": "int",
      "default": "5000",
      "desc": ""
    },
    {
      "key": "_summary_useragent_max_count",
      "section": "Summary",
      "type": "int",
      "default": "5000",
      "desc": ""
    },
    {
      "key": "_summary_error_max_count",
      "section": "Summary",
      "type": "int",
      "default": "500",
      "desc": ""
    },
    {
      "key": "_summary_enduser_nav_max_count",
      "section": "Summary",
      "type": "int",
      "default": "5000",
      "desc": ""
    },
    {
      "key": "_summary_enduser_ajax_max_count",
      "section": "Summary",
      "type": "int",
      "default": "5000",
      "desc": ""
    },
    {
      "key": "_summary_enduser_error_max_count",
      "section": "Summary",
      "type": "int",
      "default": "5000",
      "desc": ""
    }
  ],
  "host": [
    {
      "key": "net_local_udp_ip",
      "section": "Network",
      "type": "String",
      "default": "null",
      "desc": "UDP local IP"
    },
    {
      "key": "net_local_udp_port",
      "section": "Network",
      "type": "int",
      "default": "",
      "desc": "UDP local Port"
    },
    {
      "key": "net_collector_ip",
      "section": "Network",
      "type": "String",
      "default": "127.0.0.1",
      "desc": "Collector IP"
    },
    {
      "key": "net_collector_udp_port",
      "section": "Network",
      "type": "int",
      "default": "NetConstants.SERVER_UDP_PORT",
      "desc": "Collector UDP Port"
    },
    {
      "key": "net_collector_tcp_port",
      "section": "Network",
      "type": "int",
      "default": "NetConstants.SERVER_TCP_PORT",
      "desc": "Collector TCP Port"
    },
    {
      "key": "net_collector_tcp_session_count",
      "section": "Network",
      "type": "int",
      "default": "1",
      "desc": "Collector TCP Session Count"
    },
    {
      "key": "net_collector_tcp_so_timeout_ms",
      "section": "Network",
      "type": "int",
      "default": "60000",
      "desc": "Collector TCP Socket Timeout(ms)"
    },
    {
      "key": "net_collector_tcp_connection_timeout_ms",
      "section": "Network",
      "type": "int",
      "default": "3000",
      "desc": "Collector TCP Connection Timeout(ms)"
    },
    {
      "key": "net_udp_packet_max_bytes",
      "section": "Network",
      "type": "int",
      "default": "60000",
      "desc": "UDP Buffer Size"
    },
    {
      "key": "obj_type",
      "section": "Object",
      "type": "String",
      "default": "",
      "desc": "Deprecated. It's just an alias of monitoring_group_type which overrides this value."
    },
    {
      "key": "monitoring_group_type",
      "section": "Object",
      "type": "String",
      "default": "",
      "desc": "monitoring group type, commonly named as system name and a monitoring type.\neg) ORDER-JVM, WAREHOUSE-LINUX ..."
    },
    {
      "key": "obj_name",
      "section": "Object",
      "type": "String",
      "default": "",
      "desc": "Object Name"
    },
    {
      "key": "mgr_log_ignore_ids",
      "section": "Manager",
      "type": "StringSet",
      "default": "new StringSet()",
      "desc": "",
      "valueType": "COMMA_SEPARATED_VALUE"
    },
    {
      "key": "counter_enabled",
      "section": "Counter",
      "type": "boolean",
      "default": "true",
      "desc": "Activating collect counter"
    },
    {
      "key": "counter_object_registry_path",
      "section": "Counter",
      "type": "String",
      "default": "/tmp/scouter",
      "desc": "Path to file reading directory of java process ID file"
    },
    {
      "key": "counter_netstat_enabled",
      "section": "Counter",
      "type": "boolean",
      "default": "true",
      "desc": "Activating netstat counter - too many sockets(ESTABLISHED, TIME_WAIT...) may cause heavy cpu load."
    },
    {
      "key": "log_udp_object",
      "section": "Log",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "log_rotation_enabled",
      "section": "Log",
      "type": "boolean",
      "default": "true",
      "desc": "Retaining log according to date"
    },
    {
      "key": "log_dir",
      "section": "Log",
      "type": "String",
      "default": "./logs",
      "desc": "Log directory"
    },
    {
      "key": "log_keep_days",
      "section": "Log",
      "type": "int",
      "default": "365",
      "desc": "Keeping period of log"
    },
    {
      "key": "disk_alert_enabled",
      "section": "Disk",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "disk_warning_pct",
      "section": "Disk",
      "type": "int",
      "default": "70",
      "desc": ""
    },
    {
      "key": "disk_fatal_pct",
      "section": "Disk",
      "type": "int",
      "default": "90",
      "desc": ""
    },
    {
      "key": "disk_ignore_names",
      "section": "Disk",
      "type": "StringSet",
      "default": "new StringSet()",
      "desc": ""
    },
    {
      "key": "cpu_alert_enabled",
      "section": "Cpu",
      "type": "boolean",
      "default": "true",
      "desc": ""
    },
    {
      "key": "cpu_check_period_ms",
      "section": "Cpu",
      "type": "long",
      "default": "300000",
      "desc": ""
    },
    {
      "key": "cpu_alert_interval_ms",
      "section": "Cpu",
      "type": "long",
      "default": "30000",
      "desc": ""
    },
    {
      "key": "cpu_warning_pct",
      "section": "Cpu",
      "type": "int",
      "default": "70",
      "desc": ""
    },
    {
      "key": "cpu_fatal_pct",
      "section": "Cpu",
      "type": "int",
      "default": "90",
      "desc": ""
    },
    {
      "key": "cpu_warning_history",
      "section": "Cpu",
      "type": "int",
      "default": "3",
      "desc": ""
    },
    {
      "key": "cpu_fatal_history",
      "section": "Cpu",
      "type": "int",
      "default": "3",
      "desc": ""
    },
    {
      "key": "_cpu_value_avg_sec",
      "section": "Cpu",
      "type": "int",
      "default": "10",
      "desc": ""
    },
    {
      "key": "mem_alert_enabled",
      "section": "Memory",
      "type": "boolean",
      "default": "false",
      "desc": ""
    },
    {
      "key": "mem_alert_interval_ms",
      "section": "Memory",
      "type": "long",
      "default": "30000",
      "desc": ""
    },
    {
      "key": "mem_warning_pct",
      "section": "Memory",
      "type": "int",
      "default": "80",
      "desc": ""
    },
    {
      "key": "mem_fatal_pct",
      "section": "Memory",
      "type": "int",
      "default": "90",
      "desc": ""
    }
  ]
};
