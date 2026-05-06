from flask import Flask, request, jsonify
from google.cloud import bigquery
from datadog import initialize, api
import os

app = Flask(__name__)

# Datadog API 설정
DATADOG_API_KEY = os.getenv("DATADOG_API_KEY")  # 환경 변수로 API 키 가져오기
DATADOG_APP_KEY = os.getenv("DATADOG_APP_KEY")

initialize(api_key=DATADOG_API_KEY, app_key=DATADOG_APP_KEY)

# BigQuery 클라이언트 초기화
client = bigquery.Client()

@app.route("/", methods=["POST"])
def send_slot_usage():
    # BigQuery 쿼리
    QUERY = """
    SELECT
      TIMESTAMP_TRUNC(start_time, MINUTE) AS minute,
      SUM(total_slot_ms) / 1000 AS slot_seconds
    FROM
      `region-asia-northeast3`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
    WHERE
      creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
      AND statement_type = "QUERY"
      AND total_slot_ms IS NOT NULL
    GROUP BY
      minute
    ORDER BY
      minute ASC;
    """

    try:
        # BigQuery 쿼리 실행
        query_job = client.query(QUERY)
        results = query_job.result()

        # Datadog으로 데이터 전송
        for row in results:
            timestamp = int(row["minute"].timestamp())  # UNIX 타임스탬프 변환
            slot_seconds = row["slot_seconds"]

            # Datadog Custom Metric 전송
            api.Metric.send(
                metric="bigquery.slot_usage",
                points=[(timestamp, slot_seconds)],
                tags=["project:my_project", "region:asia-northeast3"]
            )

        return jsonify({"status": "success"}), 200

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)