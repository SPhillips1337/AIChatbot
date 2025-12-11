const { Client } = require('ssh2');

class DeepAgentService {
    constructor() {
        this.config = {
        this.config = {
            host: process.env.OPENCODE_HOST || 'host.docker.internal',
            port: process.env.OPENCODE_PORT || 2222,
            username: process.env.OPENCODE_USER || 'opencodeuser',
            password: process.env.OPENCODE_PASSWORD,
        };

        // Validate required credentials
        if (!this.config.password) {
            throw new Error('OPENCODE_PASSWORD environment variable is required for security');
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
                            reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
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
            throw err;
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
            case 'node': case 'javascript': cmd = `node ${tempFile}`; break;
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
                                    reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
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
            }).catch(reject);
        });
    }
        cmd += ` && rm /var/www/html/${filename}`;

        return this.executeCommand(cmd);
    }

    getExtension(lang) {
        const map = { php: 'php', python: 'py', javascript: 'js', node: 'js', bash: 'sh' };
        return map[lang.toLowerCase()] || 'txt';
    }

    /**
     * Simple agentic loop to solve a goal
     * @param {string} goal 
     * @param {Function} llmProvider Function to call the LLM
     */
    async agenticLoop(goal, llmProvider) {
        // This is a placeholder for the full ReAct loop logic
        // For now, it will simply interpret the goal as a code request if possible
        console.log(`DeepAgent received goal: ${goal}`);

        // TODO: proper Think -> Act loop
        // For MVP: Just a direct execution if the goal is simple code
        return this.executeCommand(`echo "DeepAgent processed: ${goal}"`);
    }
}

module.exports = new DeepAgentService();
