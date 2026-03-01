#!/usr/bin/env python3
"""
GRSAI Gemini-compatible layer model test script (parallel).
Tests all nano-banana models via Gemini-compatible API.
"""

import requests
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

API_KEY = "sk-c8846cb8d4834db087f0126466bf1358"
BASE_URL = "https://grsai.dakka.com.cn"

MODELS = [
    "nano-banana-fast",
    "nano-banana",
    "nano-banana-pro",
    "nano-banana-pro-vt",
    "nano-banana-pro-cl",
    "nano-banana-pro-vip",
    "nano-banana-pro-4k-vip",
]

def test_model(model_name):
    """Test a single model."""
    url = f"{BASE_URL}/v1beta/models/{model_name}:generateContent"
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": API_KEY
    }
    payload = {
        "contents": [{"parts": [{"text": "A cute little cat"}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"]
        }
    }
    
    start_time = time.time()
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=180)
        elapsed = time.time() - start_time
        
        if response.status_code != 200:
            return model_name, False, f"HTTP {response.status_code}: {response.text[:50]}", elapsed
        
        data = response.json()
        
        if "error" in data:
            return model_name, False, f"Error: {data['error'].get('message', str(data['error']))[:50]}", elapsed
        
        if "candidates" in data and data["candidates"]:
            parts = data["candidates"][0].get("content", {}).get("parts", [])
            for part in parts:
                if "inlineData" in part:
                    base64_data = part["inlineData"].get("data", "")
                    if len(base64_data) > 100:
                        kb_size = len(base64_data) * 3 // 4 // 1024
                        return model_name, True, f"base64: {len(base64_data)} chars (~{kb_size} KB)", elapsed
                    else:
                        return model_name, False, f"Invalid data: \"{base64_data}\" ({len(base64_data)} chars)", elapsed
                elif "text" in part:
                    return model_name, False, f"Returned text: {part['text'][:30]}...", elapsed

        return model_name, False, "Unknown response format", elapsed

    except requests.exceptions.Timeout:
        return model_name, False, "Request timeout (>180s)", time.time() - start_time
    except Exception as e:
        return model_name, False, f"Error: {str(e)[:50]}", time.time() - start_time

def main():
    print("=" * 60)
    print("GRSAI Gemini-compatible layer model test (parallel)")
    print("=" * 60)
    print(f"Testing {len(MODELS)} models in parallel...\n")

    results = {}
    start_total = time.time()

    # Run all tests in parallel
    with ThreadPoolExecutor(max_workers=len(MODELS)) as executor:
        futures = {executor.submit(test_model, model): model for model in MODELS}
        
        for future in as_completed(futures):
            model_name, success, message, elapsed = future.result()
            status = "✅" if success else "❌"
            print(f"  {status} {model_name:<25} | {elapsed:>5.1f}s | {message}")
            results[model_name] = (success, message, elapsed)
    
    total_time = time.time() - start_total
    
    print("\n" + "=" * 60)
    print("Test results summary")
    print("=" * 60)

    success_count = sum(1 for s, _, _ in results.values() if s)

    # Show in original order
    for model in MODELS:
        if model in results:
            success, message, elapsed = results[model]
            status = "✅" if success else "❌"
            print(f"  {status} {model}")
    
    print("-" * 60)
    print(f"  Passed: {success_count}/{len(MODELS)} | Total: {total_time:.1f}s")
    print("=" * 60)

if __name__ == "__main__":
    main()
