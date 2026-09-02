const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const pub = await prisma.$queryRawUnsafe(`SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename;`);
    console.log("=== supabase_realtime publication tables ===");
    console.log(pub);

    const grants = await prisma.$queryRawUnsafe(`SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='Seller' ORDER BY grantee, privilege_type;`);
    console.log("=== grants on Seller table ===");
    console.log(grants);

    const rls = await prisma.$queryRawUnsafe(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='Seller';`);
    console.log("=== RLS status on Seller ===");
    console.log(rls);
  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
