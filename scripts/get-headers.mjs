import https from 'https';

console.log('Sending request to https://kickoffpro.in...');
https.get('https://kickoffpro.in', (res) => {
  console.log('STATUS:', res.statusCode);
  console.log('HEADERS:', JSON.stringify(res.headers, null, 2));
}).on('error', (err) => {
  console.error('Error:', err);
});
