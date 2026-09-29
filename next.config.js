/** @type {import('next').NextConfig} */ 
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {   
  output: 'export',   
  trailingSlash: true,   
  images: { 
    unoptimized: true 
  },
  // 本機開發 (npm run dev) 時 basePath 為空，部署 (npm run build) 時才加上子路徑
  basePath: isProd ? '/penghu-dashboard' : '',
};

module.exports = nextConfig;