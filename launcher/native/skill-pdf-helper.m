// Fixed owned text-layer parser. PDFKit/Foundation are loaded only AFTER sealing.
#include <objc/runtime.h>
#include <objc/message.h>
#include <CommonCrypto/CommonDigest.h>
#include <sandbox.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef NEKODEX_PDF_SOURCE_SHA256
#error Fixed helper source SHA is required
#endif
#ifndef NEKODEX_PDF_DEVELOPMENT_PROBE
#define NEKODEX_PDF_DEVELOPMENT_PROBE 0
#endif
#define MAX_PDF (2 * 1024 * 1024)
#define MAX_TEXT (32 * 1024)
static const char *sourceSHA;
static size_t sourceBytes;
static void jsonString(const unsigned char *bytes, size_t length) {
  putchar('"');
  for (size_t i=0;i<length;i++) {
    unsigned char ch=bytes[i];
    if (ch=='"' || ch=='\\') { putchar('\\'); putchar(ch); }
    else if (ch<32) printf("\\u%04x",ch);
    else putchar(ch);
  }
  putchar('"');
}
static int result(const char *state,const char *reason,const unsigned char *text,size_t textBytes,unsigned long pages,unsigned long withText) {
  printf("{\"state\":\"%s\",\"sourceSha256\":\"%s\",\"sourceBytes\":%zu,\"coverage\":\"text-layer-only\",\"provider\":\"macos-pdfkit\",\"version\":1,\"helperSourceSha256\":\"%s\"",state,sourceSHA,sourceBytes,NEKODEX_PDF_SOURCE_SHA256);
  if (reason) printf(",\"reason\":\"%s\"",reason);
  if (pages) printf(",\"pageCount\":%lu,\"pagesWithText\":%lu,\"pagesWithoutText\":%lu",pages,withText,pages-withText);
  if (text) { fputs(",\"text\":",stdout); jsonString(text,textBytes); }
  puts("}"); fflush(stdout); return 0;
}
static unsigned char *readOwned(const char *path,size_t cap,size_t *length) {
  int fd=open(path,O_RDONLY|O_NOFOLLOW|O_CLOEXEC); if(fd<0) return NULL;
  struct stat before,after;
  if(fstat(fd,&before) || !S_ISREG(before.st_mode) || before.st_uid!=getuid() || before.st_nlink!=1 || (before.st_mode&0777)!=0400 || before.st_size<0 || (uint64_t)before.st_size>cap) { close(fd); return NULL; }
  unsigned char *bytes=calloc(cap+1,1); if(!bytes) { close(fd); return NULL; }
  size_t total=0; ssize_t n;
  while(total<cap+1 && (n=read(fd,bytes+total,cap+1-total))>0) total+=(size_t)n;
  bool stable=fstat(fd,&after)==0 && before.st_dev==after.st_dev && before.st_ino==after.st_ino && before.st_size==after.st_size && before.st_mtimespec.tv_sec==after.st_mtimespec.tv_sec && before.st_mtimespec.tv_nsec==after.st_mtimespec.tv_nsec && before.st_ctimespec.tv_sec==after.st_ctimespec.tv_sec && before.st_ctimespec.tv_nsec==after.st_ctimespec.tv_nsec;
  close(fd);
  if(!stable || total>cap || total!=(size_t)before.st_size) { free(bytes); return NULL; }
  *length=total; return bytes;
}
static bool permit(const char *path) {
  for(int i=0;i<200;i++) {
    size_t n=0; unsigned char *bytes=readOwned(path,16,&n);
    bool yes=bytes && n==5 && memcmp(bytes,"owned",5)==0;
    free(bytes); if(yes) return true; usleep(10000);
  }
  return false;
}
static bool digestMatches(const unsigned char *data,size_t size,const char *expected) {
  unsigned char raw[CC_SHA256_DIGEST_LENGTH]; char actual[65];
  CC_SHA256(data,(CC_LONG)size,raw);
  for(int i=0;i<CC_SHA256_DIGEST_LENGTH;i++) snprintf(actual+i*2,3,"%02x",raw[i]);
  return strcmp(actual,expected)==0;
}
#if NEKODEX_PDF_DEVELOPMENT_PROBE
static int proof(const char *outside,unsigned short port) {
  int fd=open(outside,O_RDONLY|O_NOFOLLOW); bool denyRead=fd<0 && (errno==EPERM || errno==EACCES); if(fd>=0)close(fd);
  fd=open(outside,O_WRONLY|O_NOFOLLOW); bool denyWrite=fd<0 && (errno==EPERM || errno==EACCES); if(fd>=0)close(fd);
  int socketFD=socket(AF_INET,SOCK_STREAM,0); bool denyNetwork=false;
  if(socketFD<0) denyNetwork=errno==EPERM || errno==EACCES;
  else { struct sockaddr_in address={0};address.sin_len=sizeof(address);address.sin_family=AF_INET;address.sin_port=htons(port);address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);denyNetwork=connect(socketFD,(struct sockaddr*)&address,sizeof(address))<0 && (errno==EPERM || errno==EACCES);close(socketFD); }
  pid_t child=fork(); bool denyFork=child<0 && (errno==EPERM || errno==EACCES);
  if(child==0)_exit(0); if(child>0)waitpid(child,NULL,0);
  char *const args[]={(char*)"/usr/bin/true",NULL};char *const env[]={NULL};
  bool denyExec=execve("/usr/bin/true",args,env)<0 && (errno==EPERM || errno==EACCES);
  printf("{\"probe\":true,\"readDenied\":%s,\"writeOpenDenied\":%s,\"networkDenied\":%s,\"forkDenied\":%s,\"execDenied\":%s}\n",denyRead?"true":"false",denyWrite?"true":"false",denyNetwork?"true":"false",denyFork?"true":"false",denyExec?"true":"false");fflush(stdout);return 0;
}
#endif
int main(int argc,char **argv) {
  // Fixed trusted supervisor supplies profile/input/permit and source identity.
  if(argc!=7 && !(NEKODEX_PDF_DEVELOPMENT_PROBE && argc==9))return 125;
  if(strcmp(argv[1],"extract")!=0 && !(NEKODEX_PDF_DEVELOPMENT_PROBE && strcmp(argv[1],"boundary-proof")==0))return 125;
  sourceSHA=argv[5]; if(strlen(sourceSHA)!=64)return 125;
  for(int i=0;i<64;i++)if(!((sourceSHA[i]>='0'&&sourceSHA[i]<='9')||(sourceSHA[i]>='a'&&sourceSHA[i]<='f')))return 125;
  char *end=NULL;unsigned long expected=strtoul(argv[6],&end,10);if(!end || *end || expected>MAX_PDF)return 125;sourceBytes=expected;
  size_t profileLength=0;unsigned char *profile=readOwned(argv[2],65536,&profileLength);
  if(!profile || !profileLength || memchr(profile,0,profileLength) || !permit(argv[4])) { free(profile);return 125; }
  struct rlimit cpu={10,10},files={64,64};if(setrlimit(RLIMIT_CPU,&cpu) || setrlimit(RLIMIT_NOFILE,&files)){free(profile);return 125;}
  char *error=NULL;int sealed=sandbox_init((const char*)profile,0,&error);free(profile);
  if(sealed!=0){if(error)sandbox_free_error(error);return 125;}
  if(write(3,"sealed\n",7)!=7)return 125;close(3);
#if NEKODEX_PDF_DEVELOPMENT_PROBE
  if(strcmp(argv[1],"boundary-proof")==0) {
    if(argc!=9)return 125;char *portEnd=NULL;unsigned long port=strtoul(argv[8],&portEnd,10);if(!portEnd||*portEnd||port<1||port>65535)return 125;
    return proof(argv[7],(unsigned short)port);
  }
#endif
  size_t length=0;unsigned char *bytes=readOwned(argv[3],MAX_PDF,&length);
  if(!bytes || length!=sourceBytes || !digestMatches(bytes,length,sourceSHA)){free(bytes);return result("unavailable","source_identity_unavailable",NULL,0,0,0);}
  if(length<5 || memcmp(bytes,"%PDF-",5)!=0){free(bytes);return result("unavailable","malformed_pdf",NULL,0,0,0);}
  // Loading framework classes is deliberately after sandbox_init and PDF identity checks.
  void *pdfkit=dlopen("/System/Library/Frameworks/PDFKit.framework/PDFKit",RTLD_NOW|RTLD_LOCAL);
  if(!pdfkit){free(bytes);return result("unavailable","pdfkit_unavailable_under_boundary",NULL,0,0,0);}
  @autoreleasepool {
    @try {
      Class dataClass=objc_getClass("NSData"),documentClass=objc_getClass("PDFDocument"),charactersClass=objc_getClass("NSCharacterSet");
      if(!dataClass||!documentClass||!charactersClass){free(bytes);return result("unavailable","pdfkit_classes_unavailable",NULL,0,0,0);}
      id data=((id(*)(id,SEL,const void*,unsigned long))objc_msgSend)((id)dataClass,sel_registerName("dataWithBytes:length:"),bytes,(unsigned long)length);free(bytes);bytes=NULL;
      id allocated=((id(*)(id,SEL))objc_msgSend)((id)documentClass,sel_registerName("alloc"));
      id document=((id(*)(id,SEL,id))objc_msgSend)(allocated,sel_registerName("initWithData:"),data);
      if(!document)return result("unavailable","malformed_pdf",NULL,0,0,0);
      if(((BOOL(*)(id,SEL))objc_msgSend)(document,sel_registerName("isEncrypted")) || ((BOOL(*)(id,SEL))objc_msgSend)(document,sel_registerName("isLocked")))return result("unavailable","encrypted_pdf",NULL,0,0,0);
      unsigned long pages=((unsigned long(*)(id,SEL))objc_msgSend)(document,sel_registerName("pageCount"));
      if(pages==0)return result("unavailable","empty_or_malformed_pdf",NULL,0,0,0);
      if(pages>32)return result("unavailable","page_limit_exceeded",NULL,0,pages,0);
      unsigned char text[MAX_TEXT+1];size_t used=0;unsigned long withText=0;
      id whitespace=((id(*)(id,SEL))objc_msgSend)((id)charactersClass,sel_registerName("whitespaceAndNewlineCharacterSet"));
      for(unsigned long i=0;i<pages;i++) {
        @autoreleasepool {
          id page=((id(*)(id,SEL,unsigned long))objc_msgSend)(document,sel_registerName("pageAtIndex:"),i);
          id string=page?((id(*)(id,SEL))objc_msgSend)(page,sel_registerName("string")):nil;
          if(!page)return result("unavailable","malformed_pdf_page",NULL,0,pages,withText);
          if(!string)continue;
          unsigned long units=((unsigned long(*)(id,SEL))objc_msgSend)(string,sel_registerName("length"));
          if(units>MAX_TEXT)return result("unavailable","text_limit_exceeded",NULL,0,pages,withText);
          id trimmed=((id(*)(id,SEL,id))objc_msgSend)(string,sel_registerName("stringByTrimmingCharactersInSet:"),whitespace);
          if(!((unsigned long(*)(id,SEL))objc_msgSend)(trimmed,sel_registerName("length")))continue;
          id encoded=((id(*)(id,SEL,unsigned long))objc_msgSend)(string,sel_registerName("dataUsingEncoding:"),4);
          if(!encoded)return result("unavailable","invalid_text_encoding",NULL,0,pages,withText);
          unsigned long size=((unsigned long(*)(id,SEL))objc_msgSend)(encoded,sel_registerName("length"));
          if(size>MAX_TEXT || used+size+(withText?2:0)>MAX_TEXT)return result("unavailable","text_limit_exceeded",NULL,0,pages,withText);
          if(withText){text[used++]='\n';text[used++]='\n';}
          const void *payload=((const void*(*)(id,SEL))objc_msgSend)(encoded,sel_registerName("bytes"));memcpy(text+used,payload,size);used+=size;withText++;
        }
      }
      if(!withText || !used)return result("unavailable","no_extractable_text_layer",NULL,0,pages,0);
      return result("completed",withText<pages?"nontext_pages_not_extracted":NULL,text,used,pages,withText);
    } @catch(id exception) { (void)exception;free(bytes);return result("unavailable","pdf_parser_rejected_input",NULL,0,0,0); }
  }
}
