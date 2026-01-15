import { useState, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import toast from "react-hot-toast";
import {
  Globe,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
  ExternalLink,
  Store,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Zap,
  Shield,
  Bird,
  Lock,
  Smartphone,
} from "lucide-react";

// 区域类型
type RegionCode = 'NA' | 'EU' | 'FE';

// 授权方式类型
type AuthMethod = 'standard' | 'ziniao';

// 区域配置类型
interface RegionConfig {
  code: string;
  name: string;
  displayFlags: string;
  marketplaces: Array<{
    code: string;
    name: string;
    flag: string;
  }>;
}

// 授权状态类型
interface RegionAuthState {
  regionCode: RegionCode;
  authUrl: string;
  status: 'pending' | 'waiting_code' | 'exchanging' | 'success' | 'error';
  code?: string;
  error?: string;
  profilesCount?: number;
  accountsCreated?: number;
}

// 步骤类型
type Step = 'select_regions' | 'authorize' | 'complete';

// 默认区域配置（当API未返回时使用）
const DEFAULT_REGIONS: RegionConfig[] = [
  {
    code: 'NA',
    name: '北美区域',
    displayFlags: '🇺🇸🇨🇦🇲🇽🇧🇷',
    marketplaces: [
      { code: 'US', name: '美国', flag: '🇺🇸' },
      { code: 'CA', name: '加拿大', flag: '🇨🇦' },
      { code: 'MX', name: '墨西哥', flag: '🇲🇽' },
      { code: 'BR', name: '巴西', flag: '🇧🇷' },
    ],
  },
  {
    code: 'EU',
    name: '欧洲区域',
    displayFlags: '🇬🇧🇩🇪🇫🇷🇮🇹🇪🇸',
    marketplaces: [
      { code: 'UK', name: '英国', flag: '🇬🇧' },
      { code: 'DE', name: '德国', flag: '🇩🇪' },
      { code: 'FR', name: '法国', flag: '🇫🇷' },
      { code: 'IT', name: '意大利', flag: '🇮🇹' },
      { code: 'ES', name: '西班牙', flag: '🇪🇸' },
      { code: 'NL', name: '荷兰', flag: '🇳🇱' },
      { code: 'SE', name: '瑞典', flag: '🇸🇪' },
      { code: 'PL', name: '波兰', flag: '🇵🇱' },
      { code: 'AE', name: '阿联酋', flag: '🇦🇪' },
      { code: 'SA', name: '沙特', flag: '🇸🇦' },
      { code: 'IN', name: '印度', flag: '🇮🇳' },
    ],
  },
  {
    code: 'FE',
    name: '远东区域',
    displayFlags: '🇯🇵🇦🇺🇸🇬',
    marketplaces: [
      { code: 'JP', name: '日本', flag: '🇯🇵' },
      { code: 'AU', name: '澳大利亚', flag: '🇦🇺' },
      { code: 'SG', name: '新加坡', flag: '🇸🇬' },
    ],
  },
];

export default function BatchAuthorization() {
  const { user, loading: authLoading } = useAuth();
  
  // 状态
  const [currentStep, setCurrentStep] = useState<Step>('select_regions');
  const [storeName, setStoreName] = useState('');
  const [selectedRegions, setSelectedRegions] = useState<RegionCode[]>([]);
  const [regionAuthStates, setRegionAuthStates] = useState<RegionAuthState[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('standard');
  
  // 获取区域配置
  const { data: regionsData, isLoading: regionsLoading } = trpc.amazonApi.getBatchAuthRegions.useQuery();
  
  // 获取已授权区域状态
  const { data: authorizedRegions, refetch: refetchAuthorized } = trpc.amazonApi.getAuthorizedRegions.useQuery();
  
  // 创建批量授权会话
  const createSessionMutation = trpc.amazonApi.createBatchAuthSession.useMutation();
  
  // 处理批量授权码
  const processBatchAuthMutation = trpc.amazonApi.processBatchAuthCodes.useMutation();
  
  // 区域配置 - 使用API数据或默认配置
  const regions: RegionConfig[] = regionsData?.regions || DEFAULT_REGIONS;
  
  // 切换区域选择
  const toggleRegion = (regionCode: RegionCode) => {
    setSelectedRegions(prev => 
      prev.includes(regionCode) 
        ? prev.filter(r => r !== regionCode)
        : [...prev, regionCode]
    );
  };
  
  // 全选/取消全选
  const toggleAllRegions = () => {
    if (selectedRegions.length === regions.length) {
      setSelectedRegions([]);
    } else {
      setSelectedRegions(regions.map(r => r.code as RegionCode));
    }
  };
  
  // 开始授权流程
  const startAuthorization = async () => {
    if (!storeName.trim()) {
      toast.error('请输入店铺名称');
      return;
    }
    if (selectedRegions.length === 0) {
      toast.error('请至少选择一个区域');
      return;
    }
    
    try {
      const result = await createSessionMutation.mutateAsync({
        storeName: storeName.trim(),
        selectedRegions,
      });
      
      // 设置授权状态
      setRegionAuthStates(result.regions.map(r => ({
        regionCode: r.regionCode as RegionCode,
        authUrl: r.authUrl,
        status: 'pending',
      })));
      
      setCurrentStep('authorize');
      
      // 根据授权方式处理
      if (authMethod === 'ziniao') {
        // 紫鸟浏览器模式：显示提示，让用户手动在紫鸟浏览器中打开
        toast.success(`请在紫鸟浏览器中打开授权链接，完成 ${result.regions.length} 个区域的授权`);
      } else {
        // 标准模式：自动打开所有授权页面
        result.regions.forEach((region, index) => {
          setTimeout(() => {
            window.open(region.authUrl, `_blank_${region.regionCode}`);
          }, index * 500);
        });
        toast.success(`已打开 ${result.regions.length} 个区域的授权页面，请在每个页面完成授权后复制授权码`);
      }
      
    } catch (error: any) {
      toast.error(`创建授权会话失败: ${error.message}`);
    }
  };
  
  // 更新授权码
  const updateAuthCode = (regionCode: RegionCode, code: string) => {
    setRegionAuthStates(prev => prev.map(state => 
      state.regionCode === regionCode 
        ? { ...state, code, status: code ? 'waiting_code' : 'pending' }
        : state
    ));
  };
  
  // 处理所有授权码
  const processAllAuthCodes = async () => {
    const codesWithRegion = regionAuthStates
      .filter(state => state.code && state.code.trim())
      .map(state => ({
        regionCode: state.regionCode,
        code: state.code!.trim(),
      }));
    
    if (codesWithRegion.length === 0) {
      toast.error('请至少输入一个区域的授权码');
      return;
    }
    
    setIsProcessing(true);
    
    // 更新状态为处理中
    setRegionAuthStates(prev => prev.map(state => ({
      ...state,
      status: codesWithRegion.some(c => c.regionCode === state.regionCode) ? 'exchanging' : state.status,
    })));
    
    try {
      const result = await processBatchAuthMutation.mutateAsync({
        storeName: storeName.trim(),
        authCodes: codesWithRegion,
      });
      
      // 更新结果状态
      setRegionAuthStates(prev => prev.map(state => {
        const regionResult = result.results.find(r => r.regionCode === state.regionCode);
        if (regionResult) {
          return {
            ...state,
            status: regionResult.status === 'success' ? 'success' : 'error',
            error: regionResult.error,
            profilesCount: regionResult.profilesCount,
            accountsCreated: regionResult.accountsCreated,
          };
        }
        return state;
      }));
      
      // 刷新已授权区域
      refetchAuthorized();
      
      // 检查是否全部成功
      const successCount = result.results.filter(r => r.status === 'success').length;
      if (successCount === codesWithRegion.length) {
        toast.success('所有区域授权成功！');
        setCurrentStep('complete');
      } else if (successCount > 0) {
        toast.success(`${successCount}/${codesWithRegion.length} 个区域授权成功`);
        setCurrentStep('complete');
      } else {
        toast.error('授权失败，请检查授权码是否正确');
      }
      
    } catch (error: any) {
      toast.error(`处理授权码失败: ${error.message}`);
      setRegionAuthStates(prev => prev.map(state => ({
        ...state,
        status: state.status === 'exchanging' ? 'error' : state.status,
        error: error.message,
      })));
    } finally {
      setIsProcessing(false);
    }
  };
  
  // 重新开始
  const resetFlow = () => {
    setCurrentStep('select_regions');
    setStoreName('');
    setSelectedRegions([]);
    setRegionAuthStates([]);
    setIsProcessing(false);
  };
  
  // 复制授权链接
  const copyAuthUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('授权链接已复制到剪贴板');
  };
  
  // 计算进度
  const completedCount = regionAuthStates.filter(s => s.status === 'success').length;
  const totalCount = regionAuthStates.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  
  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </DashboardLayout>
    );
  }
  
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">批量授权多站点</h1>
            <p className="text-muted-foreground mt-1">
              一次性授权多个Amazon广告区域，快速接入所有站点
            </p>
          </div>
          {currentStep !== 'select_regions' && (
            <Button variant="outline" onClick={resetFlow}>
              <RefreshCw className="h-4 w-4 mr-2" />
              重新开始
            </Button>
          )}
        </div>
        
        {/* 步骤指示器 */}
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 ${currentStep === 'select_regions' ? 'text-primary' : 'text-muted-foreground'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              currentStep === 'select_regions' ? 'bg-primary text-primary-foreground' : 'bg-green-500 text-white'
            }`}>
              {currentStep !== 'select_regions' ? <CheckCircle2 className="h-5 w-5" /> : '1'}
            </div>
            <span className="font-medium">选择区域</span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <div className={`flex items-center gap-2 ${currentStep === 'authorize' ? 'text-primary' : 'text-muted-foreground'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              currentStep === 'authorize' ? 'bg-primary text-primary-foreground' : 
              currentStep === 'complete' ? 'bg-green-500 text-white' : 'bg-muted'
            }`}>
              {currentStep === 'complete' ? <CheckCircle2 className="h-5 w-5" /> : '2'}
            </div>
            <span className="font-medium">完成授权</span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <div className={`flex items-center gap-2 ${currentStep === 'complete' ? 'text-primary' : 'text-muted-foreground'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              currentStep === 'complete' ? 'bg-green-500 text-white' : 'bg-muted'
            }`}>
              {currentStep === 'complete' ? <CheckCircle2 className="h-5 w-5" /> : '3'}
            </div>
            <span className="font-medium">完成</span>
          </div>
        </div>
        
        {/* 步骤1: 选择区域 */}
        {currentStep === 'select_regions' && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* 左侧: 店铺信息和区域选择 */}
            <div className="lg:col-span-2 space-y-6">
              {/* 店铺名称 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Store className="h-5 w-5" />
                    店铺信息
                  </CardTitle>
                  <CardDescription>
                    输入您的店铺名称，所有授权的站点将归属于此店铺
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label htmlFor="storeName">店铺名称</Label>
                    <Input
                      id="storeName"
                      placeholder="例如：我的品牌店铺"
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                    />
                  </div>
                </CardContent>
              </Card>
              
              {/* 授权方式选择 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    选择授权方式
                  </CardTitle>
                  <CardDescription>
                    根据您的网络环境选择合适的授权方式
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs value={authMethod} onValueChange={(v) => setAuthMethod(v as AuthMethod)}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="standard" className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        标准授权
                      </TabsTrigger>
                      <TabsTrigger value="ziniao" className="flex items-center gap-2">
                        <Bird className="h-4 w-4" />
                        紫鸟浏览器授权
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="standard" className="mt-4">
                      <Alert>
                        <Globe className="h-4 w-4" />
                        <AlertTitle>标准授权模式</AlertTitle>
                        <AlertDescription>
                          适合海外卖家或可直接访问Amazon的用户。系统将自动打开Amazon授权页面，您只需登录并授权即可。
                        </AlertDescription>
                      </Alert>
                    </TabsContent>
                    <TabsContent value="ziniao" className="mt-4">
                      <Alert className="border-purple-500/50 bg-purple-500/5">
                        <Bird className="h-4 w-4 text-purple-500" />
                        <AlertTitle className="text-purple-500">紫鸟浏览器专用授权（推荐中国大陆卖家）</AlertTitle>
                        <AlertDescription className="space-y-2">
                          <p>适合中国大陆卖家，通过紫鸟超级浏览器完成授权，更加安全稳定：</p>
                          <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                            <li>使用店铺专属IP环境，避免账号关联风险</li>
                            <li>无需科学上网，直接在紫鸟浏览器中完成授权</li>
                            <li>支持多店铺同时授权，环境隔离更安全</li>
                          </ul>
                          <div className="mt-3 p-3 bg-muted rounded-lg">
                            <p className="text-sm font-medium">使用步骤：</p>
                            <ol className="list-decimal list-inside text-sm space-y-1 mt-1">
                              <li>点击"开始授权"后，复制授权链接</li>
                              <li>在紫鸟浏览器中打开对应店铺的环境</li>
                              <li>粘贴授权链接并完成Amazon登录授权</li>
                              <li>复制回调URL中的授权码，粘贴到本页面</li>
                            </ol>
                          </div>
                        </AlertDescription>
                      </Alert>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
              
              {/* 区域选择 */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Globe className="h-5 w-5" />
                        选择授权区域
                      </CardTitle>
                      <CardDescription>
                        选择您需要授权的Amazon广告区域，每个区域包含多个站点
                      </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={toggleAllRegions}>
                      {selectedRegions.length === regions.length ? '取消全选' : '全选'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {regionsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mr-2" />
                      <span>加载区域配置...</span>
                    </div>
                  ) : regions.length === 0 ? (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>加载失败</AlertTitle>
                      <AlertDescription>
                        无法加载区域配置，请刷新页面重试
                      </AlertDescription>
                    </Alert>
                  ) : (
                    regions.map((region) => {
                      const isSelected = selectedRegions.includes(region.code as RegionCode);
                      const isAuthorized = authorizedRegions?.regions?.find(r => r.code === region.code)?.authorized;
                      
                      return (
                        <div
                          key={region.code}
                          className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                            isSelected 
                              ? 'border-primary bg-primary/5' 
                              : 'border-border hover:border-primary/50'
                          }`}
                          onClick={() => toggleRegion(region.code as RegionCode)}
                        >
                          <div className="flex items-start gap-4">
                            <Checkbox 
                              checked={isSelected}
                              onCheckedChange={() => toggleRegion(region.code as RegionCode)}
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-2xl">{region.displayFlags}</span>
                                <span className="font-semibold">{region.name}</span>
                                <Badge variant="outline">{region.code}</Badge>
                                {isAuthorized && (
                                  <Badge variant="secondary" className="bg-green-500/10 text-green-500">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    已授权
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {region.marketplaces.map((mp) => (
                                  <Badge key={mp.code} variant="outline" className="text-xs">
                                    {mp.flag} {mp.name}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>
            
            {/* 右侧: 说明和操作 */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-yellow-500" />
                    批量授权优势
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium">一键多区域授权</p>
                      <p className="text-sm text-muted-foreground">同时授权北美、欧洲、远东多个区域</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium">自动创建站点账号</p>
                      <p className="text-sm text-muted-foreground">系统自动识别并创建所有可用站点</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium">自动同步广告数据</p>
                      <p className="text-sm text-muted-foreground">授权完成后自动拉取90天历史数据</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {authMethod === 'ziniao' && (
                <Card className="border-purple-500/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-purple-500">
                      <Lock className="h-5 w-5" />
                      安全提示
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-2">
                    <p>使用紫鸟浏览器授权时，请确保：</p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      <li>在正确的店铺环境中打开授权链接</li>
                      <li>授权完成后及时复制授权码</li>
                      <li>不要在同一环境中授权多个店铺</li>
                    </ul>
                  </CardContent>
                </Card>
              )}
              
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>授权说明</AlertTitle>
                <AlertDescription className="text-sm">
                  每个区域需要单独完成Amazon登录授权。授权成功后，您将获得该区域内所有站点的广告数据访问权限。
                </AlertDescription>
              </Alert>
              
              <Button 
                className="w-full" 
                size="lg"
                onClick={startAuthorization}
                disabled={!storeName.trim() || selectedRegions.length === 0 || createSessionMutation.isPending}
              >
                {createSessionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-2" />
                )}
                开始授权 ({selectedRegions.length} 个区域)
              </Button>
            </div>
          </div>
        )}
        
        {/* 步骤2: 完成授权 */}
        {currentStep === 'authorize' && (
          <div className="space-y-6">
            {authMethod === 'ziniao' ? (
              <Alert className="bg-purple-500/10 border-purple-500/30">
                <Bird className="h-4 w-4 text-purple-500" />
                <AlertTitle>紫鸟浏览器授权模式</AlertTitle>
                <AlertDescription>
                  1. 复制下方的授权链接<br />
                  2. 在紫鸟浏览器对应店铺环境中打开链接<br />
                  3. 完成Amazon登录并授权<br />
                  4. 从回调URL中复制授权码（code参数）粘贴到下方
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="bg-blue-500/10 border-blue-500/30">
                <Info className="h-4 w-4 text-blue-500" />
                <AlertTitle>请完成以下步骤</AlertTitle>
                <AlertDescription>
                  1. 在每个打开的Amazon页面中登录并授权<br />
                  2. 授权成功后，从回调URL中复制授权码（code参数）<br />
                  3. 将授权码粘贴到下方对应的输入框中<br />
                  4. 点击"处理所有授权码"完成授权
                </AlertDescription>
              </Alert>
            )}
            
            <div className="grid gap-4">
              {regionAuthStates.map((state) => {
                const region = regions.find(r => r.code === state.regionCode);
                
                return (
                  <Card key={state.regionCode} className={
                    state.status === 'success' ? 'border-green-500/50 bg-green-500/5' :
                    state.status === 'error' ? 'border-red-500/50 bg-red-500/5' :
                    state.status === 'exchanging' ? 'border-yellow-500/50 bg-yellow-500/5' :
                    ''
                  }>
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0">
                          {state.status === 'success' ? (
                            <CheckCircle2 className="h-8 w-8 text-green-500" />
                          ) : state.status === 'error' ? (
                            <XCircle className="h-8 w-8 text-red-500" />
                          ) : state.status === 'exchanging' ? (
                            <Loader2 className="h-8 w-8 text-yellow-500 animate-spin" />
                          ) : (
                            <Globe className="h-8 w-8 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{region?.displayFlags}</span>
                            <span className="font-semibold">{region?.name}</span>
                            <Badge variant="outline">{state.regionCode}</Badge>
                            {state.status === 'success' && (
                              <Badge className="bg-green-500">授权成功</Badge>
                            )}
                            {state.status === 'error' && (
                              <Badge variant="destructive">授权失败</Badge>
                            )}
                            {state.status === 'exchanging' && (
                              <Badge className="bg-yellow-500">处理中...</Badge>
                            )}
                          </div>
                          
                          {state.status !== 'success' && (
                            <div className="space-y-2">
                              {/* 授权链接（紫鸟模式显示复制按钮） */}
                              {authMethod === 'ziniao' && (
                                <div className="flex items-center gap-2">
                                  <Input 
                                    value={state.authUrl}
                                    readOnly
                                    className="text-xs font-mono"
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => copyAuthUrl(state.authUrl)}
                                  >
                                    复制链接
                                  </Button>
                                </div>
                              )}
                              
                              <div className="flex items-center gap-2">
                                <Input
                                  placeholder="粘贴授权码 (code参数)"
                                  value={state.code || ''}
                                  onChange={(e) => updateAuthCode(state.regionCode, e.target.value)}
                                  disabled={state.status === 'exchanging'}
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => window.open(state.authUrl, '_blank')}
                                  title="在新窗口打开授权页面"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          )}
                          
                          {state.error && (
                            <p className="text-sm text-red-500">{state.error}</p>
                          )}
                          
                          {state.status === 'success' && (
                            <p className="text-sm text-green-600">
                              已创建 {state.accountsCreated} 个账号，共 {state.profilesCount} 个站点
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            
            <div className="flex justify-end gap-4">
              <Button variant="outline" onClick={resetFlow}>
                取消
              </Button>
              <Button 
                onClick={processAllAuthCodes}
                disabled={isProcessing || !regionAuthStates.some(s => s.code?.trim())}
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                处理所有授权码
              </Button>
            </div>
          </div>
        )}
        
        {/* 步骤3: 完成 */}
        {currentStep === 'complete' && (
          <div className="space-y-6">
            <Card className="border-green-500/50 bg-green-500/5">
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="h-10 w-10 text-green-500" />
                  </div>
                  <h2 className="text-2xl font-bold">授权完成！</h2>
                  <p className="text-muted-foreground">
                    已成功授权 {completedCount} 个区域，系统正在后台同步广告数据
                  </p>
                </div>
              </CardContent>
            </Card>
            
            {/* 授权结果摘要 */}
            <Card>
              <CardHeader>
                <CardTitle>授权结果</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {regionAuthStates.map((state) => {
                    const region = regions.find(r => r.code === state.regionCode);
                    return (
                      <div key={state.regionCode} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-3">
                          {state.status === 'success' ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-500" />
                          )}
                          <span>{region?.displayFlags} {region?.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {state.status === 'success' ? (
                            <>
                              <Badge variant="secondary">{state.profilesCount} 个站点</Badge>
                              <Badge className="bg-green-500">{state.accountsCreated} 个新账号</Badge>
                            </>
                          ) : (
                            <Badge variant="destructive">失败</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
            
            <div className="flex justify-center gap-4">
              <Button variant="outline" onClick={resetFlow}>
                继续授权其他区域
              </Button>
              <Button onClick={() => window.location.href = '/amazon-api'}>
                查看所有账号
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
