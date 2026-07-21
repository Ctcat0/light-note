import { initializeCloud } from "./services/cloud";

App<IAppOption>({
  globalData: {
    cloudReady: false,
    cloudErrorMessage: null,
  },

  onLaunch(): void {
    const result = initializeCloud();

    this.globalData.cloudReady = result.ready;
    this.globalData.cloudErrorMessage = result.errorMessage;
  },
});

