import assert from "node:assert/strict";
import test from "node:test";
import { createOpenMeteoProvider, type WeatherFetch } from "../cloudfunctions/weather/src/infrastructure/open-meteo-provider";

function response(body: unknown, ok = true): ReturnType<WeatherFetch> {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body });
}

test("Open-Meteo adapter 搜索城市并把同次天气刷新合并为一个请求", async () => {
  const urls: string[] = [];
  const fetcher: WeatherFetch = (url) => {
    urls.push(url);
    if (url.includes("geocoding-api.open-meteo.com")) {
      return response({ results: [{ name: "北京", latitude: 39.9042, longitude: 116.4074, country_code: "CN", country: "中国", admin1: "北京市" }] });
    }
    return response({
      utc_offset_seconds: 28_800,
      current: {
        time: "2026-07-22T12:00",
        temperature_2m: 30.2,
        apparent_temperature: 32.1,
        relative_humidity_2m: 61,
        weather_code: 2,
        wind_speed_10m: 14,
        wind_direction_10m: 90,
      },
      daily: {
        time: ["2026-07-22", "2026-07-23", "2026-07-24"],
        weather_code: [2, 61, 95],
        temperature_2m_min: [23, 22, 21],
        temperature_2m_max: [33, 31, 30],
        precipitation_probability_max: [20, 70, 80],
      },
    });
  };
  const provider = createOpenMeteoProvider({ fetcher });
  const locations = await provider.searchLocations({ keyword: "北京" });
  assert.equal(locations[0]?.locationKey, "open-meteo:39.9042,116.4074");
  assert.equal(locations[0]?.countryCode, "CN");
  const current = await provider.getCurrent(locations[0]?.locationKey ?? "", locations[0]?.displayName);
  const daily = await provider.getDaily(locations[0]?.locationKey ?? "");
  assert.equal(current.current.conditionText, "多云");
  assert.equal(current.current.windDirection, "东风");
  assert.equal(current.current.windScale, "3级");
  assert.equal(daily.daily[1]?.precipitationProbabilityPercent, 70);
  assert.equal(urls.filter((url) => url.includes("api.open-meteo.com/v1/forecast")).length, 1);
  assert.equal(urls.some((url) => /apikey|api_key|key=/iu.test(url)), false);
});

test("当前位置不调用第三方反向地理编码并使用受控坐标标识", async () => {
  const urls: string[] = [];
  const provider = createOpenMeteoProvider({ fetcher: (url) => { urls.push(url); return response({}); } });
  const locations = await provider.searchLocations({ latitude: 39.91666, longitude: 116.41666 });
  assert.equal(locations[0]?.locationKey, "open-meteo:39.9167,116.4167");
  assert.equal(locations[0]?.displayName, "当前位置");
  assert.equal(urls.length, 0);
});
