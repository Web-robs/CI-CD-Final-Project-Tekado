// backend/scripts/testCreateUser.js
const prisma = require('../prismaClient');

async function main() {
  const user = await prisma.user.create({
    data: {
      email: 'studio-test@example.com',
      password: '123456',
      name: 'Studio Test',
      emailVerified: false,
    },
  });

  console.log('Created user:', user);
}

main()
  .catch(e => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
