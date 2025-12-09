const agent = require('./DeepAgentService');

(async () => {
    try {
        console.log('Connecting to Deep Agent...');
        const output = await agent.executeCommand('echo "Hello from Sandbox"');
        console.log('Deep Agent Output:', output.trim());
        if (output.trim() === 'Hello from Sandbox') {
            console.log('VERIFICATION PASSED');
        } else {
            console.error('VERIFICATION FAILED: Output mismatch');
            process.exit(1);
        }
    } catch (err) {
        console.error('VERIFICATION FAILED:', err);
        process.exit(1);
    }
})();
