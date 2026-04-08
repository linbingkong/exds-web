import apiClient from './client';

let contractYearsCache: { data: number[]; expiresAt: number } | null = null;

// 零售合同管理API接口定义
// 基于零售合同管理模块设计方案

// 基础数据类型定义
export interface Contract {
  id: string;
  _id?: string; // 保持向后兼容
  contract_name: string;
  package_name: string;
  package_status?: string;
  package_id: string;
  customer_name: string;
  customer_id: string;
  purchasing_electricity_quantity: number;
  purchase_start_month: string;
  purchase_end_month: string;
  status: 'pending' | 'active' | 'expired';
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

// 列表响应类型
export interface ContractListResponse {
  items: Contract[];
  total: number;
  page: number;
  page_size: number;
}

// 表单数据类型（用于创建/编辑）
export interface ContractFormData {
  contract_name: string;
  package_name: string;
  package_id: string;
  customer_name: string;
  customer_id: string;
  purchasing_electricity_quantity: number;
  purchase_start_month: Date | null;
  purchase_end_month: Date | null;
}

// 创建合同请求类型
export interface ContractCreate {
  contract_name?: string;
  package_name: string;
  package_id: string;
  customer_name: string;
  customer_id: string;
  purchasing_electricity_quantity: number;
  purchase_start_month: string;
  purchase_end_month: string;
}

// 更新合同请求类型
export interface ContractUpdate {
  contract_name?: string;
  package_name?: string;
  package_id?: string;
  customer_name?: string;
  customer_id?: string;
  purchasing_electricity_quantity?: number;
  purchase_start_month?: string;
  purchase_end_month?: string;
}

// 查询参数类型
export interface ContractListParams {
  contract_name?: string;
  package_name?: string;
  customer_name?: string;
  status?: 'pending' | 'active' | 'expired' | 'all';
  purchase_start_month?: string;
  purchase_end_month?: string;
  year?: number;
  sort_field?: string;
  sort_order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

// 导入结果类型
export interface ImportError {
  row: number;
  field: string;
  value: any;
  message: string;
  suggestion?: string;
}

export interface ImportResult {
  total: number;
  success: number;
  failed: number;
  errors: ImportError[];
}

// 导出参数类型
export interface ExportParams {
  package_name?: string;
  customer_name?: string;
  status?: 'pending' | 'active' | 'expired' | 'all';
  start_month?: string;
  end_month?: string;
}

// API接口函数实现

/**
 * 获取合同列表
 * @param params 查询参数
 */
export const getContracts = (params?: ContractListParams) => {
  return apiClient.get<ContractListResponse>('/api/v1/retail-contracts', { params });
};

/**
 * 获取合同年份列表
 */
export const getContractYears = () => {
  if (contractYearsCache && contractYearsCache.expiresAt > Date.now()) {
    return Promise.resolve({ data: contractYearsCache.data } as { data: number[] });
  }

  return apiClient.get<number[]>('/api/v1/retail-contracts/years').then((response) => {
    contractYearsCache = {
      data: response.data,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    return response;
  });
};

/**
 * 获取合同详情
 * @param contractId 合同ID
 */
export const getContract = (contractId: string) => {
  return apiClient.get<Contract>(`/api/v1/retail-contracts/${contractId}`);
};

/**
 * 创建新合同
 * @param contractData 合同数据
 */
export const createContract = (contractData: ContractCreate) => {
  return apiClient.post<Contract>('/api/v1/retail-contracts', contractData);
};

/**
 * 更新合同信息
 * @param contractId 合同ID
 * @param contractData 更新数据
 */
export const updateContract = (contractId: string, contractData: ContractUpdate) => {
  return apiClient.put<Contract>(`/api/v1/retail-contracts/${contractId}`, contractData);
};

/**
 * 删除合同
 * @param contractId 合同ID
 */
export const deleteContract = (contractId: string) => {
  return apiClient.delete(`/api/v1/retail-contracts/${contractId}`);
};

/**
 * 导入合同（Excel）
 * @param file Excel文件
 */
export const importContracts = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.post<ImportResult>('/api/v1/retail-contracts/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

/**
 * 导出合同（Excel）
 * @param params 查询参数（用于筛选导出数据）
 */
export const exportContracts = (params?: ExportParams) => {
  return apiClient.get('/api/v1/retail-contracts/export', {
    params,
    responseType: 'blob'
  });
};

// 导出默认对象
export default {
  getContracts,
  getContract,
  createContract,
  updateContract,
  deleteContract,
  importContracts,
  exportContracts
};


// ##############################################################################
// PDF合同文件管理API (Contract PDF APIs)
// ##############################################################################

// PDF上传结果类型
export interface PdfUploadMatchedItem {
  filename: string;
  contract_id: string;
  contract_name: string;
  customer_name: string;
}

export interface PdfCandidateContract {
  _id: string;
  contract_name: string;
  customer_name: string;
  purchase_start_month: string;
  purchase_end_month: string;
  has_pdf: boolean;
  contract_year?: number;
}

export interface PdfUploadPendingItem {
  filename: string;
  reason: string;
  candidates: PdfCandidateContract[];
  target_contract: PdfCandidateContract | null;
}

export interface PdfUploadErrorItem {
  filename: string;
  error: string;
}

export interface PdfUploadResult {
  matched: PdfUploadMatchedItem[];
  pending: PdfUploadPendingItem[];
  errors: PdfUploadErrorItem[];
  summary: {
    total: number;
    matched_count: number;
    pending_count: number;
    error_count: number;
  };
}

/**
 * 批量上传合同PDF文件
 * @param files PDF文件数组
 */
export const uploadContractPdfs = (files: File[]) => {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  return apiClient.post<PdfUploadResult>('/api/v1/retail-contracts/upload-pdfs', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

/**
 * 获取合同PDF文件
 * @param contractId 合同ID
 */
export const getContractPdf = (contractId: string) => {
  return apiClient.get(`/api/v1/retail-contracts/${contractId}/pdf`, {
    responseType: 'blob'
  });
};

/**
 * 为指定合同上传PDF文件
 * @param contractId 合同ID
 * @param file PDF文件
 */
export const uploadContractPdf = (contractId: string, file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.post(`/api/v1/retail-contracts/${contractId}/upload-pdf`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

/**
 * 检查合同是否有PDF文件
 * @param contractId 合同ID
 */
export const checkContractHasPdf = (contractId: string) => {
  return apiClient.get<{ has_pdf: boolean }>(`/api/v1/retail-contracts/${contractId}/has-pdf`);
};

// ##############################################################################
// 导入创建合同及客户 (Import and Create New Contract APIs)
// ##############################################################################

export interface MeterPointData {
  meter_id: string;
  measuring_point: string;
  voltage_level: string;
}

export interface ParsePdfResponse {
  customer_name?: string;
  customer_short_name?: string;
  period?: string;
  package_name?: string;
  total_electricity?: number;
  attachment2?: MeterPointData[];
  location?: string;
  is_customer_new: boolean;
  is_package_new: boolean;
  is_contract_duplicate: boolean;
  duplicate_contract_id?: string;
}

export interface ImportCreateRequest {
  customer_name: string;
  customer_short_name: string;
  location?: string;
  period: string;
  package_name: string;
  total_electricity: number;
  attachment2: MeterPointData[];
}

export interface ImportCreateResponse {
  success: boolean;
  contract_id: string;
  customer_id: string;
  package_id: string;
}

/**
 * 上传PDF并解析出合同数据预览
 * @param file PDF文件
 */
export const parseContractPdf = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.post<ParsePdfResponse>('/api/v1/retail-contracts/parse-pdf', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

/**
 * 确认创建客户及合同
 * @param data 解析后经确认的数据
 */
export const importAndCreateContract = (data: ImportCreateRequest) => {
  return apiClient.post<ImportCreateResponse>('/api/v1/retail-contracts/import-create', data);
};
