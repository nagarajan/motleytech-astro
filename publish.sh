cd ~/dev/motleytech-astro
git pull
echo "Pulled latest changes"
npm run build
mkdir -p /var/www/motleytech/html
rm -rf /var/www/motleytech/html/astro
cp -r dist /var/www/motleytech/html/astro
echo "Copied dist to /var/www/motleytech/html/astro"
echo "Done"

