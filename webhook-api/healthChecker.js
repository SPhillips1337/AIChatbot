class HealthChecker {
  constructor(config) {
    this.services = {
      llm: { url: config.llmUrl, healthy: true },
      embedding: { url: config.embeddingUrl, healthy: true },
      qdrant: { url: config.qdrantUrl, healthy: true }
    };
  }

  async checkService(name) {
    try {
      const service = this.services[name];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(service.url, { 
        method: 'HEAD', 
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      service.healthy = response.ok;
    } catch (error) {
      this.services[name].healthy = false;
    }
    return this.services[name].healthy;
  }

  shouldUseMock() {
    return !this.services.llm.healthy || !this.services.embedding.healthy;
  }
}

module.exports = HealthChecker;
