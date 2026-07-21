Component({
  properties: {
    title: {
      type: String,
      value: "加载失败",
    },
    message: {
      type: String,
      value: "请检查网络后重试",
    },
    retryText: {
      type: String,
      value: "重新加载",
    },
  },

  methods: {
    handleRetry(): void {
      this.triggerEvent("retry");
    },
  },
});

