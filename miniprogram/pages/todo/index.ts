import type {
  AsyncPageMethods,
  AsyncPageState,
} from "../../types/page-state";

Page<AsyncPageState, AsyncPageMethods>({
  data: {
    viewState: "empty",
    errorMessage: "",
  },

  handleRetry(): void {
    this.setData({ viewState: "empty", errorMessage: "" });
  },
});
