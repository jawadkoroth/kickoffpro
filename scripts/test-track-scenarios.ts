import Module from 'module';

// Define mocks
let mockOrder: any = null;
let mockOrderItems: any[] = [];
let mockUser: any = null;

const mockSupabaseAdmin = {
  from: (table: string) => {
    return {
      select: () => {
        return {
          eq: (field: string, value: any) => {
            return {
              single: async () => {
                if (table === 'orders') {
                  return { data: mockOrder, error: mockOrder ? null : new Error('Not found') };
                }
                return { data: null, error: new Error('Not single') };
              },
              order: async () => {
                if (table === 'order_items') {
                  return { data: mockOrderItems, error: null };
                }
                return { data: null, error: null };
              }
            };
          }
        };
      }
    };
  }
};

const mockSupabaseServer = {
  auth: {
    getUser: async () => {
      return {
        data: { user: mockUser },
        error: null,
      };
    }
  }
};

// Intercept requires
const originalRequire = Module.prototype.require;
(Module.prototype as any).require = function (id: string) {
  const normalizedId = id.replace(/\\/g, '/').toLowerCase();
  
  if (normalizedId.includes('supabase/admin')) {
    return {
      createAdminClient: () => mockSupabaseAdmin,
    };
  }
  if (normalizedId.includes('supabase/server')) {
    return {
      createServerSupabaseClient: async () => mockSupabaseServer,
    };
  }
  if (normalizedId.includes('api-response')) {
    return {
      apiError: (status: number, message: string, details?: any) => {
        return { status, success: false, error: message, details };
      },
      apiSuccess: (data: any, status = 200) => {
        return { status, success: true, ...data };
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

// Force require to trigger CommonJS loading and interceptors
const { GET } = require('../src/app/api/orders/[id]/track/route');

async function runTests() {
  console.log('=== GUEST-ORDER TRACKING VERIFICATION AUDIT ===\n');

  const orderId = 'test-order-uuid';
  
  // Set up common mock order items
  mockOrderItems = [
    {
      product_id: 'prod-123',
      product_name: 'Spain Retro Jersey',
      size: 'M',
      quantity: 1,
      unit_price_paise: 199900,
      subtotal_paise: 199900,
      image_url: null,
    }
  ];

  let totalScenarios = 0;
  let passedScenarios = 0;

  // Helper assertion function
  function assert(name: string, expectedStatus: number, res: any) {
    totalScenarios++;
    const pass = res.status === expectedStatus;
    if (pass) passedScenarios++;
    console.log(`${name}:`);
    console.log(`- Expected Status: ${expectedStatus}`);
    console.log(`- Got Status: ${res.status}`);
    console.log(`- Result: ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
    console.log();
  }

  // SCENARIO 1: Guest order with correct email
  // Expected: 200 success
  {
    mockOrder = {
      id: orderId,
      user_id: null, // guest order
      order_number: 'KP-GUEST-0001',
      customer: {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        phone: '+919876543210',
      },
    };
    mockUser = null; // Unauthenticated guest requester

    const req = {
      nextUrl: new URL(`http://localhost/api/orders/${orderId}/track?email=jane.doe@example.com`),
    } as any;

    const res = await GET(req, { params: Promise.resolve({ id: orderId }) }) as any;
    assert('Scenario 1: Guest order with correct email', 200, res);
  }

  // SCENARIO 2: Guest order with wrong email
  // Expected: 403
  {
    mockOrder = {
      id: orderId,
      user_id: null,
      order_number: 'KP-GUEST-0001',
      customer: {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        phone: '+919876543210',
      },
    };
    mockUser = null;

    const req = {
      nextUrl: new URL(`http://localhost/api/orders/${orderId}/track?email=wrong.doe@example.com`),
    } as any;

    const res = await GET(req, { params: Promise.resolve({ id: orderId }) }) as any;
    assert('Scenario 2: Guest order with wrong email', 403, res);
  }

  // SCENARIO 3: Guest order with correct phone
  // Expected: 200 success
  {
    mockOrder = {
      id: orderId,
      user_id: null,
      order_number: 'KP-GUEST-0001',
      customer: {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        phone: '+919876543210',
      },
    };
    mockUser = null;

    const req = {
      nextUrl: new URL(`http://localhost/api/orders/${orderId}/track?phone=9876543210`),
    } as any;

    const res = await GET(req, { params: Promise.resolve({ id: orderId }) }) as any;
    assert('Scenario 3: Guest order with correct phone', 200, res);
  }

  // SCENARIO 4: Guest order with wrong phone
  // Expected: 403
  {
    mockOrder = {
      id: orderId,
      user_id: null,
      order_number: 'KP-GUEST-0001',
      customer: {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        phone: '+919876543210',
      },
    };
    mockUser = null;

    const req = {
      nextUrl: new URL(`http://localhost/api/orders/${orderId}/track?phone=1111111111`),
    } as any;

    const res = await GET(req, { params: Promise.resolve({ id: orderId }) }) as any;
    assert('Scenario 4: Guest order with wrong phone', 403, res);
  }

  // SCENARIO 5: Guest order with no email and no phone
  // Expected: 403
  {
    mockOrder = {
      id: orderId,
      user_id: null,
      order_number: 'KP-GUEST-0001',
      customer: {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        phone: '+919876543210',
      },
    };
    mockUser = null;

    const req = {
      nextUrl: new URL(`http://localhost/api/orders/${orderId}/track`),
    } as any;

    const res = await GET(req, { params: Promise.resolve({ id: orderId }) }) as any;
    assert('Scenario 5: Guest order with no email and no phone', 403, res);
  }

  // SCENARIO 6: Authenticated user accessing their own order
  // Expected: 200 success
  {
    mockOrder = {
      id: orderId,
      user_id: 'auth-user-999',
      order_number: 'KP-AUTH-9999',
      customer: {
        name: 'John Authenticated',
        email: 'john.auth@example.com',
        phone: '+918888888888',
      },
    };
    mockUser = {
      id: 'auth-user-999',
    };

    const req = {
      nextUrl: new URL(`http://localhost/api/orders/${orderId}/track`),
    } as any;

    const res = await GET(req, { params: Promise.resolve({ id: orderId }) }) as any;
    assert('Scenario 6: Authenticated user accessing their own order', 200, res);
  }

  console.log(`--- Audit Summary: ${passedScenarios}/${totalScenarios} Scenarios Passed ---`);
  if (passedScenarios !== totalScenarios) {
    process.exit(1);
  }
}

runTests().catch(err => console.error('Audit run failed:', err));
