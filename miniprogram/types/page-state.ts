export type PageViewState = "loading" | "empty" | "error" | "ready";

export interface AsyncPageState {
  viewState: PageViewState;
  errorMessage: string;
}

export interface AsyncPageMethods {
  handleRetry(): void;
}
