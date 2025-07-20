const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://cccxexvoahyeookqmxpl.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjY3hleHZvYWh5ZW9va3FteHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc0MjU5MDksImV4cCI6MjA2MzAwMTkwOX0.W4AhQt8-ZGkQa7i7rfsdJ5L1ZEn8Yx3crcrWCOGR9pA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkEventsSchema() {
  console.log('🔍 Checking events table schema...');
  
  try {
    // Try to get a single record to see the structure
    const { data: sampleEvent, error: sampleError } = await supabase
      .from('events')
      .select('*')
      .limit(1);

    if (sampleError) {
      console.log('❌ Error accessing events table:', sampleError);
      
      // Try to get table info differently
      const { data: tableInfo, error: tableError } = await supabase
        .from('events')
        .select('*');

      if (tableError) {
        console.log('❌ Table access error:', tableError);
        return;
      }
    }

    console.log('✅ Events table is accessible');
    
    // Try to insert a minimal test event to see what columns are required
    const testEvent = {
      id: 'test-event-' + Date.now(),
      title: 'Test Event',
      start_date: '2025-01-01',
      organization_id: 'your-org-id' // You'll need to replace this with actual org ID
    };

    console.log('🧪 Testing event insertion with minimal fields...');
    console.log('Test event data:', testEvent);

    const { data: insertedEvent, error: insertError } = await supabase
      .from('events')
      .insert(testEvent)
      .select();

    if (insertError) {
      console.log('❌ Insert error:', insertError);
      
      // Try to get more info about the table structure
      const { data: allEvents, error: allError } = await supabase
        .from('events')
        .select('*');

      if (allError) {
        console.log('❌ Cannot access events table:', allError);
      } else {
        console.log(`📊 Events table has ${allEvents?.length || 0} records`);
      }
    } else {
      console.log('✅ Test event inserted successfully');
      console.log('Inserted event:', insertedEvent);
      
      // Clean up test event
      const { error: deleteError } = await supabase
        .from('events')
        .delete()
        .eq('id', testEvent.id);
      
      if (deleteError) {
        console.log('⚠️ Could not clean up test event:', deleteError);
      } else {
        console.log('✅ Test event cleaned up');
      }
    }

  } catch (error) {
    console.error('❌ Error checking events schema:', error);
  }
}

// Run the check
checkEventsSchema()
  .then(() => {
    console.log('\n✅ Events schema check completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Failed to check events schema:', error);
    process.exit(1);
  });