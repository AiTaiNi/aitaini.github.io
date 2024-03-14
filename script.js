document.addEventListener("DOMContentLoaded", function() {
    const totalBlogPosts = 6;
    const postsPerPage = 3; // Number of posts to display per page
    const totalPages = Math.ceil(totalBlogPosts / postsPerPage); // Total number of pages (Assuming 6 blog posts for demonstration)

    // Load the first page
    loadPage(1);

    function loadPage(pageNumber) {
        // Calculate the start and end index of blog posts for the current page
        const startIndex = totalBlogPosts - (pageNumber - 1)*postsPerPage;
        const endIndex = Math.max(totalBlogPosts + 1 - postsPerPage * pageNumber, 1); // Assuming 6 blog posts for demonstration

        for (let i = 1; i <= postsPerPage; i++) {
            if (i <= startIndex - endIndex + 1)
                document.querySelector(`#blog-entry-${i}`).style.display = "block";
            else
                document.querySelector(`#blog-entry-${i}`).style.display = "none";
        }

        // Fetch and display blog entries for the current page sequentially
        fetchSequentially(startIndex, endIndex);

        // Generate pagination links
        generatePaginationLinks(pageNumber);
    }

    function fetchSequentially(startIndex, endIndex) {
        const promises = [];
        for (let i = startIndex; i >= endIndex; i--) {
            promises.push(fetchBlogPost(i));
        }
        Promise.all(promises)
            .then(blogPosts => {
                // Display the blog posts in the correct order
                blogPosts.forEach((blogPost, index) => {
                    displayBlogPost(blogPost, index);
                });
            })
            .catch(error => console.error('Error loading blog posts:', error));
    }

    function fetchBlogPost(postIndex) {
        return fetch(`blog-posts/blog-post-${postIndex}.json`, { cache: "no-store" })
            .then(response => response.json())
            .catch(error => console.error('Error loading blog post:', error));
    }

    function displayBlogPost(blogPost, index) {
        document.querySelector(`#blog-entry-${index+1}`).innerHTML = `
            <h2><a href="${blogPost.link}">${blogPost.title}</a></h2>
            <p>${blogPost.excerpt}</p><br>
            <a href="${blogPost.link}"><p>Read more...</p></a>
        `;
    }

    function generatePaginationLinks(currentPage) {
        // Clear existing pagination links
        document.querySelector("#pagination-top").innerHTML = "";
        document.querySelector("#pagination-bot").innerHTML = "";

        // Generate pagination links
        for (let i = 1; i <= totalPages; i++) {
            const link = document.createElement("a");
            link.textContent = i;
            link.href = "#";
            if (i === currentPage) {
                link.classList.add("active");
            }
            link.addEventListener("click", function(event) {
                event.preventDefault();
                loadPage(i);
            });
            document.querySelector("#pagination-top").appendChild(link);
        }

        for (let i = 1; i <= totalPages; i++) {
            const link = document.createElement("a");
            link.textContent = i;
            link.href = "#";
            if (i === currentPage) {
                link.classList.add("active");
            }
            link.addEventListener("click", function(event) {
                event.preventDefault();
                loadPage(i);
            });
            document.querySelector("#pagination-bot").appendChild(link);
        }
    }
});