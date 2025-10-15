// Test script for Droid provider
import { DroidApiService } from './src/droid/droid-core.js';
import { promises as fs } from 'fs';

async function testDroidProvider() {
    console.log('🧪 Testing Droid Provider (CLI-based)...\n');

    try {
        // Test 1: Initialize DroidApiService (check droid CLI availability)
        console.log('✅ Test 1: Initializing DroidApiService...');
        const service = new DroidApiService();
        await service.initialize();
        console.log('   DroidApiService initialized successfully');
        console.log('   isInitialized:', service.isInitialized);

        // Test 2: List models
        console.log('\n✅ Test 2: Listing available models...');
        const models = await service.listModels();
        console.log(`   Available models: ${models.data.length}`);
        models.data.forEach(model => {
            console.log(`   - ${model.id}`);
        });

        // Test 3: Test simple request (non-streaming)
        console.log('\n✅ Test 3: Testing simple request...');
        try {
            const response = await service.generateContent('claude-sonnet-4-5-20250929', {
                messages: [
                    { role: 'user', content: 'Say "Hello from Droid test!" in one sentence.' }
                ],
                max_tokens: 50
            });
            console.log('   Response received:');
            console.log('   Model:', response.model);
            console.log('   Stop reason:', response.stop_reason);
            if (response.content && response.content[0]) {
                console.log('   Content:', response.content[0].text);
            }
        } catch (error) {
            console.error('   ❌ Request failed:', error.message);
            console.log('   💡 Make sure you are authenticated with: droid');
        }

        console.log('\n✅ All tests completed!');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run tests
testDroidProvider().then(() => {
    console.log('\n🎉 Test suite finished');
    process.exit(0);
}).catch(error => {
    console.error('\n💥 Test suite error:', error);
    process.exit(1);
});
