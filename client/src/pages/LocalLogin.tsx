import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Eye, EyeOff } from "lucide-react";

export default function LocalLogin() {
  const [, setLocation] = useLocation();
  const [formData, setFormData] = useState({
    username: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const loginMutation = trpc.auth.localLogin.useMutation({
    onSuccess: (data) => {
      if (data.success && data.token) {
        localStorage.setItem("authToken", data.token);
        localStorage.setItem("localUser", JSON.stringify(data.user));
        setLocation("/");
        window.location.reload();
      } else {
        setError(data.error || "登录失败");
      }
    },
    onError: (err) => {
      setError(err.message || "登录失败，请稍后重试");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!formData.username) { setError("请输入用户名"); return; }
    if (!formData.password) { setError("请输入密码"); return; }
    loginMutation.mutate({ username: formData.username, password: formData.password });
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
          <CardTitle className="text-2xl text-white">登录</CardTitle>
          <CardDescription className="text-gray-400">登录 Amazon Ads Optimizer</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-gray-300">用户名</Label>
              <Input id="username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} placeholder="请输入用户名" className="bg-gray-700/50 border-gray-600 text-white" autoComplete="username" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300">密码</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? "text" : "password"} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder="请输入密码" className="bg-gray-700/50 border-gray-600 text-white pr-10" autoComplete="current-password" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && <Alert variant="destructive" className="bg-red-900/50 border-red-800"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />登录中...</> : "登录"}
            </Button>
            <div className="text-center text-sm text-gray-400">还没有账号？ <a href="/register" className="text-blue-400 hover:text-blue-300">使用邀请码注册</a></div>

          </form>
        </CardContent>
      </Card>
    </div>
  );
}
