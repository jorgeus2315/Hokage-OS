import { run, get, all } from '../db/init';
import type { Business, BusinessCreatePayload, Product, ProductCreatePayload, FinanceItem, FinanceCreatePayload } from '../types';

export async function listBusinesses(): Promise<Business[]> {
  return await all<Business>('SELECT id, name, channel, category, status, target_revenue, current_revenue, created_at FROM businesses ORDER BY id DESC');
}

export async function getBusiness(id: number): Promise<Business | undefined> {
  return await get<Business>('SELECT id, name, channel, category, status, target_revenue, current_revenue, created_at FROM businesses WHERE id = ?', [id]);
}

export async function createBusiness(payload: BusinessCreatePayload): Promise<Business> {
  const result = await run(
    'INSERT INTO businesses (name, channel, category, target_revenue, status) VALUES (?, ?, ?, ?, ?)',
    [payload.name, payload.channel || 'etsy', payload.category || null, payload.target_revenue || 0, 'draft']
  );

  const id = Number((result as any).lastID);
  const row = await get<Business>('SELECT id, name, channel, category, status, target_revenue, current_revenue, created_at FROM businesses WHERE id = ?', [id]);
  if (!row) throw new Error('Business not found after insert');
  return row;
}

export async function updateBusiness(id: number, payload: Partial<BusinessCreatePayload> & { status?: string }): Promise<Business> {
  const current = await getBusiness(id);
  if (!current) throw new Error('Business not found');

  const name = payload.name ?? current.name;
  const channel = payload.channel ?? current.channel;
  const category = payload.category ?? current.category;
  const target_revenue = payload.target_revenue ?? current.target_revenue;
  const status = payload.status ?? current.status;

  await run('UPDATE businesses SET name = ?, channel = ?, category = ?, target_revenue = ?, status = ? WHERE id = ?', [name, channel, category, target_revenue, status, id]);
  const row = await get<Business>('SELECT id, name, channel, category, status, target_revenue, current_revenue, created_at FROM businesses WHERE id = ?', [id]);
  if (!row) throw new Error('Business not found after update');
  return row;
}

export async function listProducts(businessId?: number): Promise<Product[]> {
  if (businessId) {
    return await all<Product>('SELECT id, business_id, title, price, stock, status, created_at, updated_at FROM products WHERE business_id = ? ORDER BY id DESC', [businessId]);
  }
  return await all<Product>('SELECT id, business_id, title, price, stock, status, created_at, updated_at FROM products ORDER BY id DESC');
}

export async function createProduct(payload: ProductCreatePayload): Promise<Product> {
  const result = await run(
    'INSERT INTO products (business_id, title, price, stock, status) VALUES (?, ?, ?, ?, ?)',
    [payload.business_id, payload.title, payload.price, payload.stock ?? 0, payload.status || 'draft']
  );

  const id = Number((result as any).lastID);
  const row = await get<Product>('SELECT id, business_id, title, price, stock, status, created_at, updated_at FROM products WHERE id = ?', [id]);
  if (!row) throw new Error('Product not found after insert');
  return row;
}

export async function updateProduct(id: number, payload: Partial<ProductCreatePayload> & { stock?: number }): Promise<Product> {
  const current = await get<Product>('SELECT id, business_id, title, price, stock, status, created_at, updated_at FROM products WHERE id = ?', [id]);
  if (!current) throw new Error('Product not found');

  const business_id = payload.business_id ?? current.business_id;
  const title = payload.title ?? current.title;
  const price = payload.price ?? current.price;
  const stock = payload.stock ?? current.stock;
  const status = payload.status ?? current.status;

  await run('UPDATE products SET business_id = ?, title = ?, price = ?, stock = ?, status = ?, updated_at = datetime("now") WHERE id = ?', [business_id, title, price, stock, status, id]);
  const row = await get<Product>('SELECT id, business_id, title, price, stock, status, created_at, updated_at FROM products WHERE id = ?', [id]);
  if (!row) throw new Error('Product not found after update');
  return row;
}

export async function listFinance(businessId?: number): Promise<FinanceItem[]> {
  if (businessId) {
    return await all<FinanceItem>('SELECT id, business_id, direction, amount, currency, source, created_at FROM finance WHERE business_id = ? ORDER BY id DESC', [businessId]);
  }
  return await all<FinanceItem>('SELECT id, business_id, direction, amount, currency, source, created_at FROM finance ORDER BY id DESC');
}

export async function createFinance(payload: FinanceCreatePayload): Promise<FinanceItem> {
  const result = await run(
    'INSERT INTO finance (business_id, direction, amount, currency, source) VALUES (?, ?, ?, ?, ?)',
    [payload.business_id ?? null, payload.direction || 'in', payload.amount, payload.currency || 'EUR', payload.source || null]
  );

  const id = Number((result as any).lastID);
  const row = await get<FinanceItem>('SELECT id, business_id, direction, amount, currency, source, created_at FROM finance WHERE id = ?', [id]);
  if (!row) throw new Error('Finance not found after insert');
  return row;
}
