const neo4j = require('neo4j-driver');

class GraphStore {
  constructor() {
    if (!process.env.NEO4J_URI || !process.env.NEO4J_USER || !process.env.NEO4J_PASSWORD) {
      throw new Error('Neo4j configuration missing: NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD must be set');
    }
    
    this.driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    );
  }

  async createUser(userId, username) {
    const session = this.driver.session();
    try {
      await session.run(
        'MERGE (u:User {id: $userId}) SET u.username = $username, u.created = datetime()',
        { userId, username }
      );
    } finally {
      await session.close();
    }
  }

  async addUserFact(userId, key, value) {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (u:User {id: $userId})
         MERGE (f:Fact {key: $key, value: $value})
         MERGE (u)-[:HAS_FACT]->(f)`,
        { userId, key, value }
      );
    } finally {
      await session.close();
    }
  }

  async linkConversationTopic(userId, topic, sentiment) {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (u:User {id: $userId})
         MERGE (t:Topic {name: $topic})
         MERGE (u)-[r:DISCUSSED]->(t)
         SET r.sentiment = $sentiment, r.lastDiscussed = datetime()`,
        { userId, topic, sentiment }
      );
    } finally {
      await session.close();
    }
  }

  async getUserContext(userId) {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (u:User {id: $userId})-[:HAS_FACT]->(f:Fact)
         OPTIONAL MATCH (u)-[d:DISCUSSED]->(t:Topic)
         RETURN f.key as factKey, f.value as factValue, 
                collect(DISTINCT {topic: t.name, sentiment: d.sentiment}) as topics`,
        { userId }
      );
      return result.records[0]?.toObject() || {};
    } finally {
      await session.close();
    }
  }

  async close() {
    await this.driver.close();
  }
}

module.exports = GraphStore;
