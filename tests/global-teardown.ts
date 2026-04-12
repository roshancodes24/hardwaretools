export default async function globalTeardown(): Promise<void> {
  const { prisma } = await import("../src/lib/prisma");
  await prisma.$disconnect();
}
