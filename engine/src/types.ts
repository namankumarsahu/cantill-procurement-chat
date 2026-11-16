export interface Item { item_code: string; description: string; uom: string; category: string; item_type: string; standard_price: string }
export interface Supplier { supplier_id: string; name: string; city: string; categories: string[]; status: 'Active' | 'Blocked' | 'Inactive'; on_time_pct: number; quality_rating: number }
export interface Plant { plant: string; name: string }
export interface HistoryPO { po_number: string; po_date: string; supplier_id: string; item_code: string; quantity: string; uom: string; unit_price: string; plant: string; delivered_on_time: boolean }
export interface ContractLine { item_code: string; uom: string; rate: string }
export interface Contract { contract_id: string; supplier_id: string; start_date: string; end_date: string; value_cap: string; consumed_value: string; baseline_date: string; source: 'register' | 'pdf_only'; lines: ContractLine[] }
export interface MasterData { items: Item[]; suppliers: Supplier[]; plants: Plant[]; po_history: HistoryPO[]; contracts: Contract[] }
export interface PRLine { source_row: number; pr_no: string; pr_line: string; created_at: string; requester: string; department: string; plant: string; item_code: string; description: string; quantity: string; uom: string; estimated_unit_price: string; need_by_date: string; urgency: string }
