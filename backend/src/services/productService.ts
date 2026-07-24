import { run, get, all } from '../db/init.js';
import type { Product, ProductCreatePayload } from '../types/index.js';

const SELECT = 'SELECT id, business_id, title, price, stock, status, created_at, updated_at FROM products';

export async function listProducts(businessId?: number): Promise<Product[]> {
  if (businessId) {
    return all<Product>(`${SELECT} WHERE business_id = ? ORDER BY id DESC`, [businessId]);
  }
  return all<Product>(`${SELECT} ORDER BY id DESC`);
}

export async function getProduct(id: number): Promise<Product | undefined> {
  return get<Product>(`${SELECT} WHERE id = ?`, [id]);
}

export async function createProduct(payload: ProductCreatePayload): Promise<Product> {
  const result = await run(
    'INSERT INTO products (business_id, title, price, stock, status) VALUES (?, ?, ?, ?, ?)',
    [payload.business_id, payload.title, payload.price, payload.stock ?? 0, payload.status || 'draft']
  );

  const id = Number(result.lastID);
  const row = await getProduct(id);
  if (!row) throw new Error('Product not found after insert');
  return row;
}

export async function updateProduct(id: number, payload: Partial<ProductCreatePayload> & { stock?: number }): Promise<Product> {
  const current = await getProduct(id);
  if (!current) throw new Error('Product not found');

  const business_id = payload.business_id ?? current.business_id;
  const title = payload.title ?? current.title;
  const price = payload.price ?? current.price;
  const stock = payload.stock ?? current.stock;
  const status = payload.status ?? current.status;

  await run('UPDATE products SET business_id = ?, title = ?, price = ?, stock = ?, status = ?, updated_at = datetime("now") WHERE id = ?', [business_id, title, price, stock, status, id]);
  const row = await getProduct(id);
  if (!row) throw new Error('Product not found after update');
  return row;
}
