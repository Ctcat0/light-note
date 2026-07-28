import { updateCurrentUserSettings } from "../../services/user";
import { weatherService } from "../../services/weather";
import type { PageViewState } from "../../types/page-state";
import type { WeatherLocation, WeatherResult } from "../../types/weather";
import { formatTime } from "../../utils/date";
import { normalizeError } from "../../utils/error";
import { isLocationPermissionDenied } from "../../utils/location-permission";

interface ForecastView {
  dateKey: string;
  label: string;
  conditionText: string;
  temperature: string;
}

interface WeatherPageData {
  viewState: PageViewState;
  errorMessage: string;
  query: string;
  searching: boolean;
  locating: boolean;
  autoLocationAttempted: boolean;
  saving: boolean;
  searchSource: "manual" | "geolocation";
  locations: WeatherLocation[];
  locationHint: string;
  locationPermissionDenied: boolean;
  currentLocationName: string;
  weather: WeatherResult | null;
  temperatureDisplay: string;
  feelsLikeDisplay: string;
  humidityDisplay: string;
  windDisplay: string;
  updatedDisplay: string;
  cacheNotice: string;
  forecasts: ForecastView[];
}

interface WeatherPageMethods {
  loadDefaultWeather(): Promise<void>;
  setWeather(weather: WeatherResult): void;
  handleRetry(): void;
  handleQueryInput(event: WechatMiniprogram.Input): void;
  handleSearch(): Promise<void>;
  handleUseCurrentLocation(): void;
  handleOpenLocationSettings(): void;
  handleSelectLocation(event: WechatMiniprogram.TouchEvent): Promise<void>;
}

function forecastLabel(dateKey: string, index: number): string {
  if (index === 0) return "今天";
  if (index === 1) return "明天";
  return dateKey.slice(5).replace("-", "月") + "日";
}

Page<WeatherPageData, WeatherPageMethods>({
  data: {
    viewState: "loading",
    errorMessage: "",
    query: "",
    searching: false,
    locating: false,
    autoLocationAttempted: false,
    saving: false,
    searchSource: "manual",
    locations: [],
    locationHint: "",
    locationPermissionDenied: false,
    currentLocationName: "",
    weather: null,
    temperatureDisplay: "--",
    feelsLikeDisplay: "--",
    humidityDisplay: "--",
    windDisplay: "--",
    updatedDisplay: "--",
    cacheNotice: "",
    forecasts: [],
  },

  onShow(): void {
    void this.loadDefaultWeather().then(() => {
      const settings =
        getApp<IAppOption>().globalData.userInitialization?.settings;
      if (
        settings?.preferGeolocation &&
        !this.data.autoLocationAttempted &&
        !this.data.locating
      ) {
        this.setData({ autoLocationAttempted: true });
        this.handleUseCurrentLocation();
      }
    });
  },

  async onPullDownRefresh(): Promise<void> {
    try { await this.loadDefaultWeather(); } finally { wx.stopPullDownRefresh(); }
  },

  async loadDefaultWeather(): Promise<void> {
    const app = getApp<IAppOption>();
    if (app.globalData.userInitializationState !== "ready" || app.globalData.userInitialization === null) await app.initializeUser();
    const settings = app.globalData.userInitialization?.settings;
    if (settings?.defaultLocation === null || settings === undefined) {
      this.setData({ viewState: "empty", currentLocationName: "", weather: null, errorMessage: "" });
      return;
    }
    this.setData({ viewState: "loading", errorMessage: "", currentLocationName: settings.defaultLocation.displayName });
    try {
      const weather = await weatherService.getWeather();
      this.setWeather(weather);
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: normalizeError(error).message });
    }
  },

  setWeather(weather: WeatherResult): void {
    const current = weather.current;
    this.setData({
      viewState: "ready",
      weather,
      currentLocationName: weather.location.displayName,
      temperatureDisplay: `${current.temperatureCelsius}°`,
      feelsLikeDisplay: current.apparentTemperatureCelsius === null ? "--" : `${current.apparentTemperatureCelsius}°`,
      humidityDisplay: current.humidityPercent === null ? "--" : `${current.humidityPercent}%`,
      windDisplay: [current.windDirection, current.windScale].filter(Boolean).join(" ") || "--",
      updatedDisplay: formatTime(weather.fetchedAt),
      cacheNotice: weather.cacheStatus === "stale" ? "当前展示缓存天气，请留意更新时间" : "",
      forecasts: weather.daily.map((item, index) => ({
        dateKey: item.dateKey,
        label: forecastLabel(item.dateKey, index),
        conditionText: item.conditionText,
        temperature: `${item.minTemperatureCelsius}° / ${item.maxTemperatureCelsius}°`,
      })),
      errorMessage: "",
    });
  },

  handleRetry(): void { void this.loadDefaultWeather(); },

  handleQueryInput(event): void { this.setData({ query: event.detail.value }); },

  async handleSearch(): Promise<void> {
    if (this.data.searching || this.data.query.trim().length === 0) return;
    this.setData({ searching: true, locationHint: "", locations: [], searchSource: "manual" });
    try {
      const result = await weatherService.searchLocations({ mode: "keyword", keyword: this.data.query });
      this.setData({ locations: result.items, locationHint: result.items.length === 0 ? "没有找到匹配城市，请尝试区县或城市全称" : "" });
    } catch (error) {
      this.setData({ locationHint: normalizeError(error).message });
    } finally {
      this.setData({ searching: false });
    }
  },

  handleUseCurrentLocation(): void {
    if (this.data.locating) return;
    this.setData({ locating: true, locationHint: "正在获取当前位置…", locationPermissionDenied: false, locations: [] });
    wx.getLocation({
      type: "wgs84",
      success: (result) => {
        void weatherService.searchLocations({ mode: "coordinates", latitude: result.latitude, longitude: result.longitude }).then(
          (response) => this.setData({ locations: response.items, searchSource: "geolocation", locationHint: response.items.length === 0 ? "未能识别当前位置，请手动搜索城市" : "请选择定位到的城市" }),
          (error: unknown) => this.setData({ locationHint: normalizeError(error).message }),
        ).finally(() => this.setData({ locating: false }));
      },
      fail: (error) => {
        const permissionDenied = isLocationPermissionDenied(error);
        this.setData({
          locating: false,
          locationPermissionDenied: permissionDenied,
          locationHint: permissionDenied
            ? "未获得位置权限。可以打开设置授权，或继续手动搜索城市；记账和待办不受影响"
            : "定位失败，请稍后重试或手动搜索城市",
        });
      },
    });
  },

  handleOpenLocationSettings(): void {
    if (this.data.locating) return;
    wx.openSetting({
      success: (result) => {
        const enabled = result.authSetting["scope.userLocation"] === true;
        this.setData({
          locationPermissionDenied: !enabled,
          locationHint: enabled ? "位置权限已开启，正在重新定位…" : "位置权限仍未开启，也可以继续手动搜索城市",
        });
        if (enabled) this.handleUseCurrentLocation();
      },
      fail: () => {
        this.setData({ locationHint: "无法打开权限设置，请继续手动搜索城市" });
      },
    });
  },

  async handleSelectLocation(event): Promise<void> {
    if (this.data.saving) return;
    const index = Number(event.currentTarget.dataset.index);
    const location = this.data.locations[index];
    const app = getApp<IAppOption>();
    const settings = app.globalData.userInitialization?.settings;
    if (!location || !settings) return;
    this.setData({ saving: true, locationHint: "正在保存城市…" });
    try {
      const updated = await updateCurrentUserSettings({
        expectedVersion: settings.version,
        group: "weather",
        changes: { defaultLocation: { locationKey: location.locationKey, displayName: location.displayName, source: this.data.searchSource } },
      });
      if (app.globalData.userInitialization !== null) app.globalData.userInitialization.settings = updated;
      const weather = await weatherService.getWeather(location.locationKey);
      this.setWeather(weather);
      this.setData({ locations: [], query: "", locationHint: "城市已更新" });
    } catch (error) {
      this.setData({ locationHint: normalizeError(error).message });
    } finally {
      this.setData({ saving: false });
    }
  },
});
