import { useState } from "react";
import { Link } from "wouter";
import { Calendar, Clock, ArrowRight, Tag, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAllPosts, getPostsByCategory, BlogPost } from "@/data/blogPosts";
import { PageMeta } from "@/components/PageMeta";

const categoryLabels: Record<string, string> = {
  algorithm: "算法解析",
  "case-study": "客户案例",
  tutorial: "使用教程",
  news: "产品动态"
};

const categoryColors: Record<string, string> = {
  algorithm: "bg-blue-100 text-blue-800",
  "case-study": "bg-green-100 text-green-800",
  tutorial: "bg-purple-100 text-purple-800",
  news: "bg-orange-100 text-orange-800"
};

function BlogCard({ post }: { post: BlogPost }) {
  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300 group">
      <Link href={`/blog/${post.slug}`}>
        <div className="relative aspect-video overflow-hidden">
          <img
            src={post.coverImage}
            alt={post.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          <Badge className={`absolute top-3 left-3 ${categoryColors[post.category]}`}>
            {categoryLabels[post.category]}
          </Badge>
        </div>
        <CardContent className="p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2 group-hover:text-orange-600 transition-colors">
            {post.title}
          </h3>
          <p className="text-gray-600 text-sm mb-4 line-clamp-2">
            {post.excerpt}
          </p>
          <div className="flex items-center justify-between text-sm text-gray-500">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {post.publishedAt}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {post.readingTime}分钟
              </span>
            </div>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}

export default function Blog() {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  
  const allPosts = getAllPosts();
  
  const filteredPosts = allPosts.filter(post => {
    const matchesCategory = activeCategory === "all" || post.category === activeCategory;
    const matchesSearch = searchQuery === "" || 
      post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const categories = [
    { key: "all", label: "全部文章" },
    { key: "algorithm", label: "算法解析" },
    { key: "case-study", label: "客户案例" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <PageMeta
        title="博客 - 亚马逊广告优化知识库 | Amazon Ads Optimizer"
        description="探索亚马逊广告优化的最新策略、算法解析和成功案例，帮助您提升广告效果和ROI。"
        canonicalPath="/blog"
      />
      
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl font-bold mb-4">广告优化知识库</h1>
            <p className="text-xl text-gray-300 mb-8">
              探索亚马逊广告优化的最新策略、算法解析和成功案例
            </p>
            <div className="max-w-md mx-auto">
              <Input
                type="text"
                placeholder="搜索文章..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-gray-400"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Category Filter */}
      <section className="border-b bg-white sticky top-0 z-10">
        <div className="container mx-auto px-4">
          <div className="flex gap-2 py-4 overflow-x-auto">
            {categories.map(cat => (
              <Button
                key={cat.key}
                variant={activeCategory === cat.key ? "default" : "ghost"}
                onClick={() => setActiveCategory(cat.key)}
                className={activeCategory === cat.key ? "bg-orange-600 hover:bg-orange-700" : ""}
              >
                {cat.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      {/* Blog Posts Grid */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          {filteredPosts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPosts.map(post => (
                <BlogCard key={post.id} post={post} />
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">没有找到匹配的文章</p>
            </div>
          )}
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-orange-600 text-white py-12">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold mb-4">准备好优化您的亚马逊广告了吗？</h2>
          <p className="text-orange-100 mb-6">立即开始使用我们的智能优化工具，让数据驱动您的广告决策</p>
          <Link href="/dashboard">
            <Button size="lg" variant="secondary" className="bg-white text-orange-600 hover:bg-gray-100">
              免费开始使用
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
