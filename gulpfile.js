var gulp = require('gulp'),
watch = require('gulp-watch'),
postcss = require('gulp-postcss'),
autoprefixer = require('autoprefixer'),
cssvars = require('postcss-simple-vars'),
nested = require('postcss-nested'),
cssImport = require('postcss-import'),
mixins = require('postcss-mixins'),
browserSync = require('browser-sync').create();

// This code allows watch function to work all the time,
// pointing out the error.

gulp.task('styles', function(){
  return gulp.src('./app/assets/styles/styles.css')
  .pipe(postcss([cssImport, mixins, cssvars, nested, autoprefixer]))
  .on('error', function(errorInfo){
    console.log(errorInfo.toString());
    this.emit('end');
  })
  .pipe(gulp.dest('./app/tempo/styles'));
});


// watch functions:

gulp.task('watch', function(){

// This code refreshes the HTML web everytime I save (app is the folder html is in)
browserSync.init({
  server: {
    baseDir: "app"
  }
});
// this code watches for any changes in HTML files

watch('./app/index.html', function() {
    browserSync.reload();

  });

// this code watches for any changes in css files

watch('./app/assets/styles/**/*.css', function(){
  gulp.start('cssInject');

  });

});

// This code inject CSS to the web everytime I save it

gulp.task('cssInject', ['styles'],function(){
  return gulp.src('./app/tempo/styles/styles.css')
  .pipe(browserSync.stream());
})
