import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const link = await prisma.link.findFirst({
  where: { url: { contains: 'avc.xyz/what-happened-in-2025' } },
  select: {
    id: true,
    url: true,
    title: true,
    contentText: true,
    contentHtml: true,
    rawHtml: true,
    fetchStatus: true,
    wordCount: true,
  }
});

if (link) {
  console.log('=== Link found ===');
  console.log('ID:', link.id);
  console.log('URL:', link.url);
  console.log('Title:', link.title);
  console.log('Fetch Status:', link.fetchStatus);
  console.log('Word Count:', link.wordCount);
  console.log('contentText length:', link.contentText?.length || 0);
  console.log('contentHtml length:', link.contentHtml?.length || 0);
  console.log('rawHtml length:', link.rawHtml?.length || 0);
  console.log('');
  console.log('=== contentText (first 500 chars) ===');
  console.log(link.contentText?.substring(0, 500) || 'NULL');
  console.log('');
  console.log('=== contentHtml (first 1000 chars) ===');
  console.log(link.contentHtml?.substring(0, 1000) || 'NULL');
} else {
  console.log('Link not found');
}

await prisma.$disconnect();
