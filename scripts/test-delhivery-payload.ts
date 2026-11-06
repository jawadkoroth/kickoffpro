import { DelhiveryProvider } from '../src/lib/shipping/delhivery';
import { ShipmentRequest, ProviderConfig } from '../src/lib/shipping/types';

// Mock config
const mockConfig: ProviderConfig = {
  id: 'delhivery-test-id',
  name: 'delhivery',
  environment: 'sandbox',
  api_url: 'https://track.delhivery.com',
  api_key: 'test_api_key_12345',
  api_secret: null,
  webhook_secret: null,
  token: null,
  token_expires_at: null,
  auth_email: null,
  auth_password_encrypted: null,
  pickup_name: 'KickoffPro Warehouse Delhi',
  pickup_phone: '9876543210',
  pickup_gstin: null,
  pickup_line1: '123 Warehouse Lane',
  pickup_line2: 'Okhla Phase 3',
  pickup_city: 'New Delhi',
  pickup_state: 'Delhi',
  pickup_pincode: '110020',
  features_cod: true,
  features_reverse: false,
  features_insurance: false,
};

// Mock shipment request
const mockRequest: ShipmentRequest = {
  order_number: 'KP-2026-9999',
  customer: {
    name: 'John Doe',
    phone: '9999999999',
    email: 'johndoe@example.com',
  },
  address: {
    line1: '456 Guest Street',
    line2: 'Apartment 2B',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
  },
  product: {
    name: 'Argentina Retro Jersey - L',
    quantity: 2,
    weight_grams: 500,
  },
  payment: {
    method: 'cod',
    cod_amount_paise: 299900, // 2999 INR
  },
};

// Intercept global fetch
const originalFetch = global.fetch;
let capturedBody: any = null;
let capturedHeaders: any = null;
let capturedUrl: string = '';

global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  capturedUrl = input.toString();
  capturedHeaders = init?.headers;
  capturedBody = init?.body;

  // Return a mock success response
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      packages: [{
        waybill: '1234567890',
        status: 'Success',
      }],
    }),
  } as Response;
};

async function runTest() {
  console.log('--- DELHIvery PAYLOAD SERIALIZATION DIAGNOSTIC ---');
  
  const provider = new DelhiveryProvider(mockConfig);
  
  // 1. Pre-flight validation
  const validationError = provider.validateShipmentRequest(mockRequest);
  if (validationError) {
    console.error('Validation failed:', validationError);
    process.exit(1);
  }
  console.log('✓ Pre-flight validation passed.');

  // 2. Perform createShipment
  const response = await provider.createShipment(mockRequest);
  
  console.log('\n--- Intercepted Request Details ---');
  console.log('URL:', capturedUrl);
  console.log('Headers:', capturedHeaders);
  
  if (capturedBody instanceof FormData) {
    console.log('Body is instance of FormData: Yes ✓');
    
    // Extract fields
    const formatField = capturedBody.get('format');
    const dataField = capturedBody.get('data');
    
    console.log('FormData format field:', formatField);
    console.log('FormData data field string:', dataField);
    
    try {
      const parsedData = JSON.parse(dataField as string);
      console.log('\nParsed JSON Data payload for Delhivery:');
      console.log(JSON.stringify(parsedData, null, 2));
      
      // Verification assertions
      if (formatField === 'json' && parsedData.shipments && parsedData.pickup_location) {
        console.log('\n✓ Success: Payload is properly formed and conforms to Delhivery One API specifications.');
      } else {
        console.log('\n✗ Error: Payload fields do not match expected format.');
      }
    } catch (e: any) {
      console.error('Failed to parse data field as JSON:', e.message);
    }
  } else {
    console.error('✗ Error: Body is NOT an instance of FormData!', typeof capturedBody);
  }

  console.log('\nResponse returned to caller:', response);
}

runTest()
  .catch(err => console.error('Test execution failed:', err))
  .finally(() => {
    global.fetch = originalFetch;
  });
