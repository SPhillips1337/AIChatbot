const { Client } = require('ssh2');

class DeepAgentService {
    constructor() {
        this.config = {
            host: process.env.OPENCODE_HOST || 'host.docker.internal',
            port: process.env.OPENCODE_PORT || 2222,
            username: process.env.OPENCODE_USER || 'opencodeuser',
            password: process.env.OPENCODE_PASSWORD,
        };

        // Validate required credentials
        if (!this.config.password) {
            // Warn but don't crash, as it might not be used if mocked
            console.warn('OPENCODE_PASSWORD environment variable is missing (required for SSH)');
        }
    }

    /**
     * Establishes an SSH connection to the sandbox
     * @returns {Promise<Client>}
     */
    async connect() {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            
            console.log(`Attempting SSH connection to ${this.config.host}:${this.config.port} as ${this.config.username}`);
            
            conn.on('ready', () => {
                console.log('SSH connection established successfully');
                resolve(conn);
            }).on('error', (err) => {
                console.error('SSH connection error:', err.message);
                reject(new Error(`SSH connection failed: ${err.message}`));
            }).connect(this.config);
        });
    }

    /**
     * Executes a command in the sandbox
     * @param {string} command 
     * @returns {Promise<string>} Output of the command
     */
    async executeCommand(command) {
        let conn;
        try {
            conn = await this.connect();
            return new Promise((resolve, reject) => {
                conn.exec(command, (err, stream) => {
                    if (err) return reject(err);
                    let stdout = '';
                    let stderr = '';
                    stream.on('close', (code, signal) => {
                        conn.end();
                        if (code !== 0) {
                            // If there's stderr, prefer that, otherwise stdout might contain error info
                            resolve(`Error (Exit Code ${code}): ${stderr || stdout}`);
                        } else {
                            resolve(stdout);
                        }
                    }).on('data', (data) => {
                        stdout += data;
                    }).stderr.on('data', (data) => {
                        stderr += data;
                    });
                });
            });
        } catch (err) {
            if (conn) conn.end();
            return `Execution Error: ${err.message}`;
        }
    }

    async runCode(code, language = 'php') {
        const filename = `task_${Date.now()}.${this.getExtension(language)}`;
        
        // Use proper file writing instead of echo to prevent injection
        const tempFile = `/tmp/${filename}`;
        
        let cmd;
        switch (language.toLowerCase()) {
            case 'php': cmd = `php ${tempFile}`; break;
            case 'python': cmd = `python3 ${tempFile}`; break;
            case 'node': case 'javascript': case 'js': cmd = `node ${tempFile}`; break;
            case 'bash': case 'sh': cmd = `bash ${tempFile}`; break;
            default: throw new Error(`Unsupported language: ${language}`);
        }

        return new Promise((resolve, reject) => {
            this.connect().then(conn => {
                // First write the file using SFTP
                conn.sftp((err, sftp) => {
                    if (err) return reject(err);
                    
                    sftp.writeFile(tempFile, code, (err) => {
                        if (err) return reject(err);
                        
                        // Then execute it
                        conn.exec(`${cmd} && rm ${tempFile}`, (err, stream) => {
                            if (err) return reject(err);
                            
                            let stdout = '';
                            let stderr = '';
                            stream.on('close', (code, signal) => {
                                conn.end();
                                if (code !== 0) {
                                    resolve(`Error (Exit Code ${code}): ${stderr || stdout}`);
                                } else {
                                    resolve(stdout);
                                }
                            }).on('data', (data) => {
                                stdout += data;
                            }).stderr.on('data', (data) => {
                                stderr += data;
                            });
                        });
                    });
                });
            }).catch(err => resolve(`Execution Error: ${err.message}`));
        });
    }

    getExtension(lang) {
        const map = { php: 'php', python: 'py', javascript: 'js', node: 'js', bash: 'sh', sh: 'sh' };
        return map[lang.toLowerCase()] || 'txt';
    }

    /**
     * Simple agentic loop to solve a goal
     * @param {string} goal 
     * @param {Function} llmProvider Function to call the LLM
     */
    async agenticLoop(goal, llmProvider) {
        console.log(`DeepAgent received goal: ${goal}`);

        if (!llmProvider) {
            return `Error: DeepAgent requires an LLM provider to function.`;
        }

        const SYSTEM_PROMPT = `You are a Deep Agent capable of reasoning and executing code in a secure sandbox.
Answer the following questions as best you can. You have access to the following tools:

execute_command: Execute a shell command. Input: command string.
run_code: Run code in a specific language. Input: code block with language specifier (e.g. \`\`\`python ... \`\`\`).

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [execute_command, run_code]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Action: Finish
Action Input: the final answer to the original input question

Begin!`;

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Question: ${goal}` }
        ];

        let steps = 0;
        const MAX_STEPS = 10;

        while (steps < MAX_STEPS) {
            console.log(`DeepAgent Step ${steps + 1}`);

            // Get LLM response
            let response;
            try {
                response = await llmProvider(messages);
            } catch (err) {
                return `LLM Error: ${err.message}`;
            }

            console.log(`DeepAgent Thought: ${response.split('\n')[0]}...`);

            // Append assistant response to history
            messages.push({ role: 'assistant', content: response });

            // Parse response
            const actionMatch = response.match(/Action:\s*(.+)/i);

            if (!actionMatch) {
                // If no action is found, ask the LLM to provide one or conclude
                messages.push({ role: 'user', content: "Observation: I did not find an Action. Please provide an Action (execute_command, run_code, or Finish)." });
                steps++;
                continue;
            }

            const action = actionMatch[1].trim();

            // Extract Action Input
            const inputRegex = /Action Input:([\s\S]*)/i;
            const inputMatch = response.match(inputRegex);
            let actionInput = inputMatch ? inputMatch[1].trim() : '';

            // Handle "Finish"
            if (action.toLowerCase() === 'finish') {
                return actionInput || response;
            }

            // Execute Action
            let observation;
            console.log(`DeepAgent Action: ${action}`);

            try {
                if (action.toLowerCase() === 'execute_command') {
                    // Clean up markdown code blocks if present in input
                    const cmd = actionInput.replace(/^```(bash|sh)?\n?|\n?```$/g, '').trim();
                    observation = await this.executeCommand(cmd);
                } else if (action.toLowerCase() === 'run_code') {
                    // Parse language and code
                    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/;
                    const codeMatch = actionInput.match(codeBlockRegex);

                    if (codeMatch) {
                        const lang = codeMatch[1] || 'bash';
                        const code = codeMatch[2];
                        observation = await this.runCode(code, lang);
                    } else {
                        observation = "Error: run_code requires a markdown code block.";
                    }
                } else {
                    observation = `Error: Unknown action '${action}'. Supported actions: execute_command, run_code, Finish`;
                }
            } catch (err) {
                observation = `Error executing action: ${err.message}`;
            }

            // Truncate observation if too long to avoid token limits
            if (observation.length > 2000) {
                observation = observation.substring(0, 2000) + "... (output truncated)";
            }

            console.log(`DeepAgent Observation: ${observation.substring(0, 50)}...`);

            // Append observation to history
            messages.push({ role: 'user', content: `Observation: ${observation}` });

            steps++;
        }

        return "DeepAgent timed out: Max steps reached without a final answer.";
    }
}

module.exports = new DeepAgentService();
