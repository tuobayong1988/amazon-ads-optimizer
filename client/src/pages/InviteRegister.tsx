import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "../lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle, XCircle, Eye, EyeOff } from "lucide-react";

export default function InviteRegister() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const inviteCodeFromUrl = searchParams.get("code") || "";

  const [formData, setFormData] = useState({
    inviteCode: inviteCodeFromUrl,
    username: "",
    password: "",
    confirmPassword: "",
    name: "",
    email: "",
    organizationName: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [inviteValid, setInviteValid] = useState<boolean | null>(null);
  const [inviteInfo, setInviteInfo] = useState<any>(null);

  // 验证邀请码
  const validateInvite = trpc.inviteCode.validate.useQuery(
    { code: formData.inviteCode },
    { 
      enabled: formData.inviteCode.length >= 6,
      retry: false,
    }
  );

  // 注册mutation
  const registerMutation = trpc.auth.localRegister.useMutation({
    onSuccess: (data) => {
      if (data.success && data.token) {
        // 保存token到localStorage
        localStorage.setItem("authToken", data.token);
        localStorage.setItem("localUser", JSON.stringify(data.user));
        // 跳转到首页
        setLocation("/");
        window.location.reload();
      } else {
        setError(data.error || "注册失败");
      }
    },
    onError: (err) => {
      setError(err.message || "注册失败，请稍后重试");
    },
  });

  useEffect(() => {
    if (validateInvite.data) {
      setInviteValid(validateInvite.data.valid);
      setInviteInfo(validateInvite.data.inviteCode);
      if (!validateInvite.data.valid) {
        setError(validateInvite.data.error || "邀请码无效");
      } else {
        setError("");
      }
    }
  }, [validateInvite.data]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 验证表单
    if (!formData.inviteCode) {
      setError("请输入邀请码");
      return;
    }
    if (!inviteValid) {
      setError("邀请码无效，请检查后重试");
      return;
    }
    if (formData.username.length < 3) {
      setError("用户名至少3个字符");
      return;
    }
    if (formData.password.length < 6) {
      setError("密码至少6个字符");
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (!formData.name) {
      setError("请输入您的姓名");
      return;
    }

    registerMutation.mutate({
      inviteCode: formData.inviteCode,
      username: formData.username,
      password: formData.password,
      name: formData.name,
      email: formData.email || undefined,
      organizationName: formData.organizationName || undefined,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-gray-800/50 border-gray-700">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              <span className="text-2xl font-bold text-white">AO</span>
            </div>
          </div>
          <CardTitle className="text-2xl text-white">注册账号</CardTitle>
          <CardDescription className="text-gray-400">
            使用邀请码注册 Amazon Ads Optimizer
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 邀请码 */}
            <div className="space-y-2">
              <Label htmlFor="inviteCode" className="text-gray-300">邀请码 *</Label>
              <div className="relative">
                <Input
                  id="inviteCode"
                  value={formData.inviteCode}
                  onChange={(e) => setFormData({ ...formData, inviteCode: e.target.value.toUpperCase() })}
                  placeholder="请输入邀请码"
                  className="bg-gray-700/50 border-gray-600 text-white pr-10"
                  maxLength={20}
                />
                {formData.inviteCode.length >= 6 && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {validateInvite.isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : inviteValid ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                  </div>
                )}
              </div>
              {inviteValid && inviteInfo && (
                <p className="text-xs text-green-400">
                  邀请码有效 - {inviteInfo.inviteType === 'external_user' ? '外部用户邀请' : '团队成员邀请'}
                </p>
              )}
            </div>

            {/* 用户名 */}
            <div className="space-y-2">
              <Label htmlFor="username" className="text-gray-300">用户名 *</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="用于登录的用户名"
                className="bg-gray-700/50 border-gray-600 text-white"
                maxLength={50}
              />
            </div>

            {/* 姓名 */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-gray-300">姓名 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="您的真实姓名"
                className="bg-gray-700/50 border-gray-600 text-white"
                maxLength={100}
              />
            </div>

            {/* 邮箱 */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-300">邮箱（可选）</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="用于接收通知"
                className="bg-gray-700/50 border-gray-600 text-white"
              />
            </div>

            {/* 组织名称（仅外部用户显示） */}
            {inviteInfo?.inviteType === 'external_user' && (
              <div className="space-y-2">
                <Label htmlFor="organizationName" className="text-gray-300">团队/公司名称（可选）</Label>
                <Input
                  id="organizationName"
                  value={formData.organizationName}
                  onChange={(e) => setFormData({ ...formData, organizationName: e.target.value })}
                  placeholder="您的团队或公司名称"
                  className="bg-gray-700/50 border-gray-600 text-white"
                  maxLength={100}
                />
              </div>
            )}

            {/* 密码 */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300">密码 *</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="至少6个字符"
                  className="bg-gray-700/50 border-gray-600 text-white pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* 确认密码 */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-gray-300">确认密码 *</Label>
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                placeholder="再次输入密码"
                className="bg-gray-700/50 border-gray-600 text-white"
              />
            </div>

            {/* 错误提示 */}
            {error && (
              <Alert variant="destructive" className="bg-red-900/50 border-red-800">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* 提交按钮 */}
            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              disabled={registerMutation.isPending || !inviteValid}
            >
              {registerMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  注册中...
                </>
              ) : (
                "注册"
              )}
            </Button>

            {/* 已有账号 */}
            <div className="text-center text-sm text-gray-400">
              已有账号？{" "}
              <a href="/local-login" className="text-blue-400 hover:text-blue-300">
                立即登录
              </a>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
