def test_health_reports_ok_and_never_leaks_the_key(api):
    client, _ = api()
    body = client.get("/health").json()

    assert body["status"] == "ok" and body["database"] == "ok"
    assert set(body["llm"]) == {"base_url", "model_large", "model_small", "api_key_configured"}
