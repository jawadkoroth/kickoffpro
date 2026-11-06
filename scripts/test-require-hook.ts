import Module from 'module';

// Intercept require
const originalRequire = Module.prototype.require;
(Module.prototype as any).require = function (id: string) {
  if (id === 'next/headers') {
    return {
      cookies: async () => {
        return {
          getAll: () => [{ name: 'mock-cookie', value: '123' }],
          set: () => {},
        };
      },
    };
  }
  return originalRequire.apply(this, arguments as any);
};

async function test() {
  const { cookies } = require('next/headers');
  const cookieStore = await cookies();
  console.log('Intercepted cookies:', cookieStore.getAll());
}

test();
