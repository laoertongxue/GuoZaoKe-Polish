/** Fixed public diagnostics only: never persist or display an upstream response body. */
export const ANALYSIS_ERRORS: Record<string,string> = {
 missing_key:'请在模型设置中补充 API Key，然后重试。',invalid_key:'请填写有效的 API Key。',
 unauthorized:'API Key 无效或已过期，请在模型设置中更新。',rate_limited:'模型服务正忙，请稍后重试，或换一个模型。',
 http_error:'模型服务拒绝了请求，请检查模型名称、账户余额和 API 地址，或换一个模型。',
 network:'连接模型失败，请检查网络和 API 地址后重试。',timeout:'模型响应超时，请重试或换一个模型。',
 output_truncated:'模型回答被截断，未保存不完整结论。请换一个模型，或在高级设置中增加最大输出长度后重新分析。',
 invalid_json:'模型没有返回完整的分析数据，请重试或换一个模型。',schema:'模型回答不符合分析要求，请重试或换一个模型。',
 too_large:'模型返回内容过大，已停止本次请求。',cancelled:'分析已停止，已完成的内容仍然保留。',
 permission_required:'尚未授权访问所需服务，请到设置中授权。',budget_exhausted:'本次分析已达到调用上限，已完成结果保留。可在高级工作区调整后继续。',
 stage_failed:'本次分析未能完成，请重试或换一个模型。',provider_failed:'模型请求未完成，请重试或换一个模型。',
 configuration_changed:'模型配置已变化，请重新分析；旧结果仍保留。',qualification_changed:'试验资格已变化，请重新分析。',
 qualification_model_changed:'服务实际返回的模型发生变化，请检查模型设置后重新分析。',configuration_invalidated:'原模型校准已失效，请新建校准。',
 missing_configuration:'请先添加分析模型。',missing_run:'本次任务已不存在，请重新分析。',request_in_progress:'分析正在进行，请等待或先停止。',
 invalid_request:'请求未能处理，请重新打开分析页面。',invalid_reservation:'任务状态已变化，请重新打开分析页面。',
 invalid_config:'请检查模型配置是否填写完整。',invalid_url:'请填写有效的公开 HTTPS 地址。',
 source_budget_exhausted:'资料读取额度已用完，已有结果保留。',source_budget_changed:'资料读取预算已变化，请重新分析。',source_budget_corrupt:'资料读取记录异常，请重新分析。',
 coverage:'模型遗漏了原文或评价单元，未保存不完整判断。请重试或换一个模型。',
 ownership:'模型混淆了发言或主张归属，结果未通过检查。请重试或换一个模型。',
 span:'模型引用与原文不一致，结果未通过检查。请重试或换一个模型。',
 reference:'模型引用了不存在的材料，结果未通过检查。请重试或换一个模型。',
 unread_evidence:'模型使用了尚未读取的资料，结果未通过检查。',source_attribution:'模型混淆了资料提供者，结果未通过检查。',
 dimension:'回复判断不符合评价规则，请重试或换一个模型。',stage_schema:'模型返回的字段不符合分析要求，请重试或换一个模型。',
 input_too_large:'帖子内容超过当前处理范围，无法完整分析。',context:'模型对缺失语境作出了确定判断，结果未通过检查。',qualification:'模型试验资格未通过验证。',
};
export function analysisErrorCode(error:unknown):string {
 const value=error as {code?:unknown;message?:unknown}|null;
 if(typeof value?.code==='string' && Object.hasOwn(ANALYSIS_ERRORS,value.code))return value.code;
 if(typeof value?.message==='string'){
  const prefix=value.message.split(/[: ]/)[0]!;
  if(Object.hasOwn(ANALYSIS_ERRORS,prefix))return prefix;
 }
 return 'stage_failed';
}
export function unwrapAnalysisResponse(response:any):any {
 if(response?.ok)return response.data;
 const code=analysisErrorCode({code:response?.code,message:response?.error});
 throw Object.assign(new Error(ANALYSIS_ERRORS[code]),{code});
}
