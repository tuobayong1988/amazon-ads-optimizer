/**
 * Strategy Center 布局调整脚本 v2
 * 将策略模板库移动到优化目标之前
 */
(function() {
  'use strict';
  
  function adjustLayout() {
    // 查找包含"策略模板库"的section
    var allDivs = document.querySelectorAll('div');
    var templatesSection = null;
    var tabsSection = null;
    
    for (var i = 0; i < allDivs.length; i++) {
      var div = allDivs[i];
      var text = div.textContent || '';
      
      // 查找策略模板库section（包含"策略模板库"标题和"应用此策略"按钮）
      if (text.indexOf('策略模板库') !== -1 && 
          text.indexOf('选择预设的优化策略模板') !== -1 &&
          div.querySelector('button')) {
        // 确保这是最外层的策略模板容器
        var parent = div.parentElement;
        if (parent && parent.children.length > 1) {
          templatesSection = div;
        }
      }
      
      // 查找Tabs section（包含优化目标、广告活动、自动化配置）
      if (div.querySelector('[role="tablist"]') && 
          text.indexOf('优化目标') !== -1 &&
          text.indexOf('广告活动') !== -1) {
        tabsSection = div;
      }
    }
    
    if (!templatesSection || !tabsSection) {
      console.log('[Layout v2] Elements not found, retrying...');
      return false;
    }
    
    // 获取共同的父容器
    var templatesParent = templatesSection.parentElement;
    var tabsParent = tabsSection.parentElement;
    
    if (templatesParent !== tabsParent) {
      console.log('[Layout v2] Different parents, cannot adjust');
      return false;
    }
    
    var parent = templatesParent;
    
    // 检查是否已经调整过
    if (parent.getAttribute('data-layout-adjusted') === 'true') {
      console.log('[Layout v2] Already adjusted');
      return true;
    }
    
    // 获取元素在父容器中的位置
    var children = Array.prototype.slice.call(parent.children);
    var templatesIndex = children.indexOf(templatesSection);
    var tabsIndex = children.indexOf(tabsSection);
    
    console.log('[Layout v2] Templates index:', templatesIndex, 'Tabs index:', tabsIndex);
    
    // 如果策略模板已经在Tabs之前，不需要调整
    if (templatesIndex < tabsIndex) {
      console.log('[Layout v2] Layout already correct');
      parent.setAttribute('data-layout-adjusted', 'true');
      return true;
    }
    
    // 将策略模板移动到Tabs之前
    parent.insertBefore(templatesSection, tabsSection);
    parent.setAttribute('data-layout-adjusted', 'true');
    console.log('[Layout v2] Layout adjusted successfully!');
    return true;
  }
  
  function init() {
    if (window.location.pathname.indexOf('strategy-center') === -1) {
      return;
    }
    
    console.log('[Layout v2] Initializing...');
    
    // 延迟执行，等待React渲染完成
    var attempts = 0;
    var maxAttempts = 30;
    
    var interval = setInterval(function() {
      attempts++;
      if (adjustLayout() || attempts >= maxAttempts) {
        clearInterval(interval);
        if (attempts >= maxAttempts) {
          console.log('[Layout v2] Max attempts reached');
        }
      }
    }, 200);
  }
  
  // 监听URL变化
  var lastUrl = window.location.href;
  var observer = new MutationObserver(function() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      if (window.location.pathname.indexOf('strategy-center') !== -1) {
        setTimeout(init, 500);
      }
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  
  // 初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
