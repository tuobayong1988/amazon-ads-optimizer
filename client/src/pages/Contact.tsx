import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PublicLayout from "@/components/PublicLayout";
import {
  Building2,
  MapPin,
  Mail,
  Clock,
  MessageSquare,
  Send,
  CheckCircle2,
  Globe,
  Shield,
} from "lucide-react";
import toast from "react-hot-toast";

export default function Contact() {
  useEffect(() => {
    document.title = "联系我们 - PPC Optimizer";
  }, []);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    subject: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.message) {
      toast.error("请填写必填字段");
      return;
    }
    setIsSubmitting(true);
    // 模拟提交（实际可对接后端API或邮件服务）
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSubmitting(false);
    setSubmitted(true);
    toast.success("消息已发送，我们会尽快回复您！");
  };

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="relative container text-center">
          <Badge variant="outline" className="mb-4">联系我们</Badge>
          <h1 className="text-4xl lg:text-5xl font-bold mb-6">与我们取得联系</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            无论是产品咨询、技术支持还是商务合作，我们都期待听到您的声音
          </p>
        </div>
      </section>

      {/* 联系信息卡片 */}
      <section className="py-16 bg-card/30">
        <div className="container">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            <Card className="text-center hover:shadow-lg transition-shadow">
              <CardContent className="pt-8 pb-6">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-7 h-7 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">公司名称</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Shenzhen Yipin Mingxuan<br />Technology Co., Ltd.
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  深圳一品名轩科技有限公司
                </p>
              </CardContent>
            </Card>

            <Card className="text-center hover:shadow-lg transition-shadow">
              <CardContent className="pt-8 pb-6">
                <div className="w-14 h-14 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                  <MapPin className="w-7 h-7 text-blue-500" />
                </div>
                <h3 className="font-semibold mb-2">公司地址</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  深圳市龙岗区坂田街道<br />
                  岗头社区新围仔五和大道<br />
                  4004号名筑大厦608
                </p>
              </CardContent>
            </Card>

            <Card className="text-center hover:shadow-lg transition-shadow">
              <CardContent className="pt-8 pb-6">
                <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                  <Mail className="w-7 h-7 text-green-500" />
                </div>
                <h3 className="font-semibold mb-2">联系邮箱</h3>
                <a href="mailto:vip@ppcopt.com" className="text-sm text-primary hover:underline">
                  vip@ppcopt.com
                </a>
                <p className="text-sm text-muted-foreground mt-2">
                  工作日24小时内回复
                </p>
              </CardContent>
            </Card>

            <Card className="text-center hover:shadow-lg transition-shadow">
              <CardContent className="pt-8 pb-6">
                <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-7 h-7 text-amber-500" />
                </div>
                <h3 className="font-semibold mb-2">工作时间</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  周一至周五<br />
                  9:00 - 18:00 (CST)
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  系统7×24小时运行
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* 联系表单 + 服务承诺 */}
      <section className="py-24">
        <div className="container">
          <div className="grid lg:grid-cols-5 gap-12 max-w-6xl mx-auto">
            {/* 左侧：联系表单 */}
            <div className="lg:col-span-3">
              <h2 className="text-2xl font-bold mb-2">发送消息</h2>
              <p className="text-muted-foreground mb-8">
                填写以下表单，我们的团队会在工作日24小时内回复您
              </p>

              {submitted ? (
                <Card className="border-green-500/30 bg-green-500/5">
                  <CardContent className="py-16 text-center">
                    <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold mb-2">消息已发送</h3>
                    <p className="text-muted-foreground mb-6">
                      感谢您的联系！我们会在工作日24小时内回复您。
                    </p>
                    <Button variant="outline" onClick={() => { setSubmitted(false); setFormData({ name: "", email: "", company: "", subject: "", message: "" }); }}>
                      发送新消息
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        姓名 <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-4 py-3 rounded-lg bg-card border border-border/50 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors text-sm"
                        placeholder="您的姓名"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        邮箱 <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-4 py-3 rounded-lg bg-card border border-border/50 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors text-sm"
                        placeholder="your@email.com"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium mb-2">公司名称</label>
                      <input
                        type="text"
                        value={formData.company}
                        onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                        className="w-full px-4 py-3 rounded-lg bg-card border border-border/50 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors text-sm"
                        placeholder="您的公司名称（选填）"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">主题</label>
                      <select
                        value={formData.subject}
                        onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                        className="w-full px-4 py-3 rounded-lg bg-card border border-border/50 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors text-sm"
                      >
                        <option value="">请选择咨询主题</option>
                        <option value="product">产品咨询</option>
                        <option value="technical">技术支持</option>
                        <option value="business">商务合作</option>
                        <option value="feedback">意见反馈</option>
                        <option value="other">其他</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      消息内容 <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      rows={6}
                      className="w-full px-4 py-3 rounded-lg bg-card border border-border/50 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors text-sm resize-none"
                      placeholder="请描述您的需求或问题..."
                      required
                    />
                  </div>

                  <Button type="submit" size="lg" disabled={isSubmitting} className="w-full md:w-auto">
                    {isSubmitting ? (
                      <>发送中...</>
                    ) : (
                      <>
                        发送消息
                        <Send className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              )}
            </div>

            {/* 右侧：服务承诺 */}
            <div className="lg:col-span-2">
              <h2 className="text-2xl font-bold mb-2">我们的承诺</h2>
              <p className="text-muted-foreground mb-8">
                选择PPC Optimizer，您将获得专业、安全、高效的广告优化服务
              </p>

              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <h4 className="font-medium mb-1">快速响应</h4>
                    <p className="text-sm text-muted-foreground">工作日24小时内回复所有咨询，紧急技术问题优先处理</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                    <Globe className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <h4 className="font-medium mb-1">全球站点支持</h4>
                    <p className="text-sm text-muted-foreground">支持Amazon全球10+站点，包括US、CA、UK、DE、JP等主流市场</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                    <Shield className="w-5 h-5 text-amber-500" />
                  </div>
                  <div>
                    <h4 className="font-medium mb-1">数据安全保障</h4>
                    <p className="text-sm text-muted-foreground">使用Amazon官方API，OAuth 2.0认证，HTTPS加密传输，AWS企业级安全</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-purple-500" />
                  </div>
                  <div>
                    <h4 className="font-medium mb-1">7×24小时运行</h4>
                    <p className="text-sm text-muted-foreground">系统全天候自动运行，15分钟级数据同步，确保您的广告始终处于最优状态</p>
                  </div>
                </div>
              </div>

              {/* 直接联系 */}
              <div className="mt-10 p-6 rounded-xl bg-card border border-border/50">
                <h4 className="font-semibold mb-3">更快的联系方式</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  如需紧急支持，可直接发送邮件至：
                </p>
                <a
                  href="mailto:vip@ppcopt.com"
                  className="inline-flex items-center gap-2 text-primary hover:underline font-medium"
                >
                  <Mail className="w-4 h-4" />
                  vip@ppcopt.com
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
