import { useRoute, Link } from "wouter";
import { Calendar, Clock, ArrowLeft, Tag, User, Share2, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getPostBySlug, getRelatedPosts, BlogPost as BlogPostType } from "@/data/blogPosts";
import { PageMeta } from "@/components/PageMeta";
import ReactMarkdown from "react-markdown";

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

function RelatedPostCard({ post }: { post: BlogPostType }) {
  return (
    <Link href={`/blog/${post.slug}`}>
      <Card className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer">
        <div className="flex">
          <div className="w-24 h-24 flex-shrink-0">
            <img
              src={post.coverImage}
              alt={post.title}
              className="w-full h-full object-cover"
            />
          </div>
          <CardContent className="p-3 flex-1">
            <h4 className="font-medium text-sm line-clamp-2 hover:text-orange-600 transition-colors">
              {post.title}
            </h4>
            <p className="text-xs text-gray-500 mt-1">{post.publishedAt}</p>
          </CardContent>
        </div>
      </Card>
    </Link>
  );
}

export default function BlogPost() {
  const [, params] = useRoute("/blog/:slug");
  const slug = params?.slug;
  
  if (!slug) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>文章不存在</p>
      </div>
    );
  }

  const post = getPostBySlug(slug);
  
  if (!post) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4">
        <p className="text-xl text-gray-600">文章不存在</p>
        <Link href="/blog">
          <Button>
            <ArrowLeft className="mr-2 w-4 h-4" />
            返回博客列表
          </Button>
        </Link>
      </div>
    );
  }

  const relatedPosts = getRelatedPosts(slug, 3);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: post.title,
          text: post.excerpt,
          url: window.location.href,
        });
      } catch (err) {
        console.log("分享取消");
      }
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert("链接已复制到剪贴板");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <PageMeta
        title={`${post.title} | Amazon Ads Optimizer 博客`}
        description={post.excerpt}
        canonicalPath={`/blog/${post.slug}`}
      />
      
      {/* Breadcrumb */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-3">
          <nav className="flex items-center text-sm text-gray-500">
            <Link href="/" className="hover:text-orange-600">首页</Link>
            <ChevronRight className="w-4 h-4 mx-2" />
            <Link href="/blog" className="hover:text-orange-600">博客</Link>
            <ChevronRight className="w-4 h-4 mx-2" />
            <span className="text-gray-900 truncate max-w-xs">{post.title}</span>
          </nav>
        </div>
      </div>

      {/* Hero Image */}
      <div className="relative h-64 md:h-96 overflow-hidden">
        <img
          src={post.coverImage}
          alt={post.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 md:p-12">
          <div className="container mx-auto">
            <Badge className={`${categoryColors[post.category]} mb-3`}>
              {categoryLabels[post.category]}
            </Badge>
            <h1 className="text-2xl md:text-4xl font-bold text-white mb-4 max-w-4xl">
              {post.title}
            </h1>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Main Content */}
          <article className="flex-1 max-w-4xl">
            {/* Meta Info */}
            <div className="flex flex-wrap items-center gap-4 mb-8 pb-6 border-b">
              <div className="flex items-center gap-3">
                <Avatar className="w-10 h-10">
                  <AvatarFallback className="bg-orange-100 text-orange-600">
                    {post.author.name[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-gray-900">{post.author.name}</p>
                  <p className="text-sm text-gray-500">{post.author.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-500 ml-auto">
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {post.publishedAt}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {post.readingTime}分钟阅读
                </span>
                <Button variant="ghost" size="sm" onClick={handleShare}>
                  <Share2 className="w-4 h-4 mr-1" />
                  分享
                </Button>
              </div>
            </div>

            {/* Article Content */}
            <div className="prose prose-lg max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-a:text-orange-600 prose-strong:text-gray-900 prose-blockquote:border-orange-500 prose-blockquote:bg-orange-50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r prose-table:border prose-th:bg-gray-100 prose-th:p-3 prose-td:p-3 prose-td:border">
              <ReactMarkdown>{post.content}</ReactMarkdown>
            </div>

            {/* Tags */}
            <div className="mt-8 pt-6 border-t">
              <div className="flex items-center gap-2 flex-wrap">
                <Tag className="w-4 h-4 text-gray-500" />
                {post.tags.map(tag => (
                  <Badge key={tag} variant="secondary" className="bg-gray-100">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Back to Blog */}
            <div className="mt-8">
              <Link href="/blog">
                <Button variant="outline">
                  <ArrowLeft className="mr-2 w-4 h-4" />
                  返回博客列表
                </Button>
              </Link>
            </div>
          </article>

          {/* Sidebar */}
          <aside className="lg:w-80 flex-shrink-0">
            <div className="sticky top-4 space-y-6">
              {/* Related Posts */}
              {relatedPosts.length > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-gray-900 mb-4">相关文章</h3>
                    <div className="space-y-3">
                      {relatedPosts.map(relatedPost => (
                        <RelatedPostCard key={relatedPost.id} post={relatedPost} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* CTA Card */}
              <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                <CardContent className="p-6">
                  <h3 className="font-semibold text-lg mb-2">准备好优化您的广告了吗？</h3>
                  <p className="text-orange-100 text-sm mb-4">
                    立即开始使用我们的智能优化工具
                  </p>
                  <Link href="/dashboard">
                    <Button className="w-full bg-white text-orange-600 hover:bg-gray-100">
                      免费开始使用
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
